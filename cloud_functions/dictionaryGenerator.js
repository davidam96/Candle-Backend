import { Configuration, OpenAIApi } from "openai";


//Set the API key to use the openai client
const configuration = new Configuration({
    //For GCF, type this instead (after setting up the 'OPENAI_API_KEY'
    //environment variable with its value equal to the API key):
    //apiKey: process.env.OPENAI_API_KEY,
    apiKey: "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",
});
let openai = new OpenAIApi(configuration);


//Google Cloud functions initializer (not relevant in local execution)
export async function dictionaryGenerator(req, res) {
    let words = req.body.words || "dog";
    await init(words).then(doc => {
      console.log(doc);
      res.status(200).send(doc);
    });
}


//Main function, executes everything else
export async function init(words) {
    //Parse the request JSON into a request object
    let request = new Request(words);

    //Create a personalised response object
    let response = new Response(words);

    //Probes if the words in the request are valid
    //ones, if so then proceeds to populate them
    response = await errorHandler(request, response);
    if (response.error === "") {
        await populate(request);
        response.data = request;
    }

    //Return a response with either a populated word JSON or an exception
    const response_json = JSON.stringify(response);
    console.log(response_json);
    return response_json;
}


//Constructor for the request object
export class Request {
  constructor(words) {
    this.words=words;
    this.meanings=[];
    this.types=[];
    this.translations=[];
    this.synonyms=[];
    this.examples=[];
  }
}


//Constructor for the response object
export class Response {
  constructor(words) {
    this.data=new Request(words);
    this.error="";
    this.errCode=-1;
  }
}


//Checks wether a word or a phrase is a valid one
export async function errorHandler(request, response) {
    const charCount = request.words.length;
    const wordsCount = request.words.split(/\s/).length;
    if (wordsCount === 1 && charCount <= 20) {
        const isValidWord = await checkWord(request.words);
        if (!isValidWord) {
            response.error = "Invalid word.";
            response.errCode = 0;
        }
    }
    else if (wordsCount > 1 && wordsCount < 10 && charCount <= 100) {
        //First we check if each given word in the phrase is valid
        let allWordsAreValid = true;
        const words = request.words.split(/\s/);
        const promises = [];
        words.forEach(word => {
            promises.push(checkWord(word));
        });
        await Promise.all(promises)
        .then(results => {
          results.find(result => {
            if (!result) {
              response.error = "The phrase contains an invalid word."
              response.errCode = 1;
              allWordsAreValid = false;
              return true;
            }
            return false;
          });
        });
        //Then, if all words in the phrase are valid, we check and
        //correct the phrase gramatically and assign it its type.
        if (allWordsAreValid) {
            const isValidPhrase = await checkPhrase(request);
            if (!isValidPhrase) {
                response.error = "Invalid phrase. It's neither an idiom nor a verb";
                response.errCode = 2;
            }
        }
    }
    else {
        response.error = "Invalid request format.";
        response.errCode = 3;
    }
    return response;
}


// Checks if a given input is a valid word in the english dictionary.
export async function checkWord(word) {  
    const answer = await openai.createAnswer({
        model: "davinci",
        question: `Is ${word} an english word?`,
        examples_context: "English words: dog, cat, phone, joy, ...",
        examples: [["Is 'dog' an english word?", "Yes"],
                  ["Is 'asdafsaf' an english word?", "No"]],
        documents: [],
        max_tokens: 1
    });
    if (answer.data.answers !== null && 
        answer.data.answers[0].toLowerCase().includes("yes"))
        return true;
    return false;
}


//Checks if a given group of words are a valid idiom or verb. In case
//they are not, it corrects it and tries with the correction instead
export async function checkPhrase(request) {  

    let isValidPhrase = false;

    //GPT3 checks wether a group of words is gramatically correct
    const gram_p = await openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is the phrase '${request.words}' gramatically correct?:\r\n`
        + "(answer with yes/no)\r\n",
        max_tokens: 5
    });
    const isGramaticallyCorrect = gram_p.data.choices[0].text.toLowerCase().includes("yes");

    //GPT3 corrects gramatically a group of words
    if (!isGramaticallyCorrect) {
        const corr_p = await openai.createCompletion("text-davinci-002", 
        {
            prompt: `Correct '${request.words}' gramatically:\r\n`
            + "(answer with just the phrase)\r\n",
            max_tokens: 200
        });
        request.words = corr_p.data.choices[0].text.toLowerCase()
        .replace(/\r?\n|\r|^\s+|\s+$|\<([^\>]*)\>|\./gm, '');
    }

    //GPT3 sorts out wether a group of words is an idiom
    const idm_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is the phrase '${request.words}' an idiom?:\r\n`
        + "(answer with yes/no)\r\n",
        max_tokens: 5
    });

    //GPT3 sorts out wether a group of words is a verb
    const vb_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is the phrase '${request.words}' a verb?:\r\n`
        + "(answer with yes/no)\r\n",
        max_tokens: 5
    });

    //Fills the word type and returns true if the
    //phrase is wether an idiom, a verb or both.
    await Promise.all([idm_p, vb_p])
    .then(([idm_r, vb_r]) => {
        const isIdiom = idm_r.data.choices[0].text.toLowerCase().includes("yes");
        const isVerb = vb_r.data.choices[0].text.toLowerCase().includes("yes");
        if (isIdiom)
            request.types.push("idiom");
        if (isVerb) 
            request.types.push("verb");
        if (isIdiom || isVerb)
            isValidPhrase = true;
    });
    return isValidPhrase;
}


//Fills the request object with meanings for the word or phrase
export async function populate(request) {

    //GPT3 creates a promise with the 5 most common meanings for your word
    const mean_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `These are the 5 most common meanings for '${request.words}':\r\n`
        + "(do not repeat the same phrase twice)\r\n" + "1.",
        max_tokens: 200
    });

    //GPT3 sorts the possible syntactic types for a given word
    if (request.words.split(/\s/).length === 1) {
        const types = await sortTypes(request.words);
        request.types.push(...types);
    }

    //GPT3 creates a response with 10 spanish translations for your word
    const tran_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `These are 10 synonyms for '${request.words}' in Spanish:\r\n`,
        max_tokens: 100
    });

    //GPT3 creates a response with 10 synonyms for your word
    const syn_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `These are 10 synonyms for '${request.words}':\r\n`,
        max_tokens: 100
    });

    //GPT3 creates a response with 3 phrase examples for your word
    const ex_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Write 3 phrases with '${request.words}' and a lenght of 10 words or more:\r\n1.`,
        temperature: 0.9,
        max_tokens: 200
    });

    //This executes all the above promises asynchronously so they complete in parallel
    await Promise.all([mean_p, tran_p, syn_p, ex_p])
    .then(([r_mean, r_tran, r_syn, r_ex]) => {
        //Convert the meanings response text to an array
        const meanings_txt = `1.${r_mean.data.choices[0].text.toLowerCase()}`;
        const meanings = meanings_txt.split(/\d./);
        cleanArray(meanings);
        //Convert the translations response text to an array
        const translations_txt = r_tran.data.choices[0].text.toLowerCase();
        const translations = translations_txt.split(/\d.|,|\\./);
        cleanArray(translations);
        //Convert the synonyms response text to an array
        const synonyms_txt = r_syn.data.choices[0].text.toLowerCase();
        const synonyms = synonyms_txt.split(/\d.|,|\\./);
        cleanArray(synonyms);
        //Convert the examples response text to an array
        const examples_txt = r_ex.data.choices[0].text;
        const examples = examples_txt.split(/\d./);
        cleanArray(examples);
        //Store all the data into the request object
        request.meanings.push(...meanings);
        request.translations.push(...translations);
        request.synonyms.push(...synonyms);
        request.examples.push(...examples);
    });
}


//Uses regex to clean the format the response texts come out
export function cleanArray(array) {
    array.forEach((el, i) => {
        array[i] = el.replace(/\r?\n|\r|^\s+|\s+$|\<([^\>]*)\>/gm, '');
        if (el.split(/\s/).length < 5) 
            array[i] = array[i].replace(/\./gm, '');
    });
    array.forEach((el, i) => {
        if (el === '' || el === '.' || el === ',')
            array.splice(i,1);
    });
}


//Sorts out all the possible syntactic types for a given word
export async function sortTypes(word) {
    const nn_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is '${word}' used as a noun?\r\n`
        + "(answer with yes/no)\r\n",
        max_tokens: 5
    });

    const vb_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is '${word}' sometimes used as a verb?\r\n`
        + "(answer with yes/no)\r\n",
        max_tokens: 5
    });

    const adj_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is '${word}' used as an adjective?\r\n`
        + "(answer with yes/no)\r\n",
        max_tokens: 5
    });

    const adv_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is '${word}' used as an adverb?\r\n`
        + "(answer with yes/no)\r\n",
        max_tokens: 5
    });

    const prep_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is '${word}' used as a preposition?\r\n`
        + "(answer with yes/no)\r\n",
        max_tokens: 5
    });

    let types = [];
    await Promise.all([nn_p, vb_p, adj_p, adv_p, prep_p])
    .then(([nn_r, vb_r, adj_r, adv_r, prep_r]) => {
        if (nn_r.data.choices[0].text.toLowerCase().includes("yes"))
            types.push("noun");
        if (vb_r.data.choices[0].text.toLowerCase().includes("yes"))
            types.push("verb");
        if (adj_r.data.choices[0].text.toLowerCase().includes("yes"))
            types.push("adjective");
        if (adv_r.data.choices[0].text.toLowerCase().includes("yes"))
            types.push("adverb");
        if (prep_r.data.choices[0].text.toLowerCase().includes("yes"))
            types.push("preposition");
    });
    return types; 
}


//Execute all the above code
init("dog");