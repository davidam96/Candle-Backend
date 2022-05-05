import { Configuration, OpenAIApi } from "openai";


//Set the API key to use the openai client
const configuration = new Configuration({
    //Remember setting up the 'OPENAI_API_KEY' environment variable with its
    //value equal to the API key both in your local and GCF's environment variables:
    //(In case of the local system, you have to reboot in order for the env_var to appear)
    apiKey: process.env.OPENAI_API_KEY,
});
let openai = new OpenAIApi(configuration);


//Google Cloud functions entry point (not relevant in local execution)
export async function dictionaryGenerator(req, res) {
    let words = req.body.words || JSON.parse(req.body.data).words || "";
    await init(words).then(doc => {
      console.log(doc);
      res.status(200).send(doc);
    });
}


//Main function, executes everything else
export async function init(words) {
    //correct the words request
    words = correctWords(words);

    //Parse the request JSON into a request object
    let request = new Request(words);

    //Create a personalised response object
    let response = new Response(words);

    //Checks if the words in the request are valid
    //ones, if so then proceeds to populate them
    response = await errorHandler(request, response);
    if (response.data.error === "") {
        await populate(request);
        response.data.contents = request;
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
    this.wordCount=words.split(/\s/gm).length;
    this.types=[];
    this.meanings=[];
    this.translations=[];
    this.synonyms=[];
    this.examples=[];
    this.combinations=[];
  }
}


//Constructor for the response object
export class Response {
  constructor(words) {
    this.data=new Data(words);
  }
}


export class Data {
    constructor(words) {
        this.contents=new Request(words);
        this.error="";
        this.errorCode=-1;
      }
}


//Filters out repeated words and multilines
export function correctWords(words) {
    //The first regex serves to fuse a multiline string into a single line
    words = words.replace(/(\r?\n)+|\r+|\n+|\t+/gm, " ").trim().toLowerCase();
    //This second regex is used to eliminate all duplicate consecutive words except one
    return words.replace(/\b(\w+)(?=\W\1\b)+\W?/gm, "");
}


//Checks wether a word or a phrase is a valid one
export async function errorHandler(request, response) {
    const charCount = request.words.length;
    if (request.words === "") {
        response.data.error = "Empty request.";
        response.data.errorCode = 0;
    }
    else if (request.wordCount === 1 && charCount <= 30) {
        const isValidWord = await checkWord(request.words);
        if (!isValidWord) {
            response.data.error = "Invalid word.";
            response.data.errorCode = 1;
        }
    }
    else if (request.wordCount > 1 && request.wordCount <= 13 && charCount <= 130) {
        //First we check if each given word in the phrase is valid
        let allWordsAreValid = true;
        const words = request.words.split(/\s/gm);
        const promises = [];
        words.forEach(word => {
            promises.push(checkWord(word.replace(/'([\s\S]*)$/gm, '')));
        });
        await Promise.all(promises)
        .then(results => {
          results.find(result => {
            if (!result) {
              response.data.error = "The phrase contains an invalid word."
              response.data.errorCode = 2;
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
                response.data.error = "Invalid phrase. It's neither an idiom nor a verb";
                response.data.errorCode = 3;
            }
        }
    }
    else if (request.wordCount > 13) {
        response.data.error = "Limit of 13 words exceeded";
        response.data.errorCode = 4;
    }
    else if (charCount > 130) {
        response.data.error = "Limit of 130 characters exceeded";
        response.data.errorCode = 5;
    }
    else {
        response.data.error = "Invalid request format.";
        response.data.errorCode = 6;
    }
    return response;
}


// Checks if a given input is a valid word in the english dictionary.
export async function checkWord(word) {  
    const answer = await openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is "${word}" an english word?:\r\n`
        + "(answer with yes/no)\r\n",
        max_tokens: 5
    });
    return answer.data.choices[0].text.toLowerCase().includes("yes");
}


//Checks if a given group of words are a valid idiom or verb. In case
//they are not, it corrects it and tries with the correction instead
export async function checkPhrase(request) {  

    let isValidPhrase = false;
    //await correctPhrase(request.words);

    //GPT3 sorts out wether a group of words is an idiom
    const idm_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is "${request.words}" an idiom?:\r\n`
        + "(answer with yes/no)\r\n",
        max_tokens: 5
    });

    //GPT3 sorts out wether a group of words is a verb
    const vb_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is "to ${request.words}" a valid verb?:\r\n`
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
        prompt: `These are the 5 most common definitions for "${request.words}":\r\n`
        + "(each definition must have more than 3 words)\r\n1. ",
        max_tokens: 120
    });

    //GPT3 sorts the possible syntactic types for a given word
    if (request.words.split(/\s/gm).length === 1) {
        const types = await sortTypes(request.words);
        request.types.push(...types);
    }

    //GPT3 creates a response with 10 spanish translations for your word
    const tran_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `These are 10 synonyms for "${request.words}" in Spanish:\r\n`,
        max_tokens: 60
    });

    //GPT3 creates a response with 10 synonyms for your word
    const syn_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `These are 10 synonyms for "${request.words}":\r\n`,
        max_tokens: 60
    });

    //GPT3 creates a response with 3 phrase examples for your word
    const ex_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Write 3 phrases with "${request.words}":\r\n1.`,
        temperature: 0.9,
        max_tokens: 120
    });

    //This executes all the above promises asynchronously so they complete in parallel
    await Promise.all([mean_p, tran_p, syn_p, ex_p])
    .then(([mean_r, tran_r, syn_r, ex_r]) => {
        //Convert the meanings response text to an array
        const meanings_txt = mean_r.data.choices[0].text;
        let meanings = cleanArray(meanings_txt.split(/\d./gm));
        //Convert the translations response text to an array
        const translations_txt = tran_r.data.choices[0].text;
        let translations = cleanArray(translations_txt.split(/\d.|\,/gm));
        //Convert the synonyms response text to an array
        const synonyms_txt = syn_r.data.choices[0].text;
        let synonyms = cleanArray(synonyms_txt.split(/\d.|\,/gm));
        //Convert the examples response text to an array
        const examples_txt = ex_r.data.choices[0].text;
        let examples = cleanArray(examples_txt.split(/\d./gm));
        examples.forEach((example,i) => {
            example = example.charAt(0).toUpperCase() + `${example.slice(1)}.`;
            examples[i] = example;
        });
        //Store all the data into the request object
        request.meanings.push(...meanings);
        request.translations.push(...translations);
        request.synonyms.push(...synonyms);
        request.examples.push(...examples);
    });
}


//Uses regex to clean string elements inside of an array
export function cleanArray(array) {
    if (array.length === 1) {
        // This is a special case which only triggers for synonyms and translations:
        // If they arrive into one line separated only by spaces, this splits them apart
        array = array.split(/\s/gm);
    }
    array.forEach((el, i) => {
        //Fuse multiline into one line
        el = el.replace(/(\r?\n)+|\r+|\n+|\t+/gm, " ");
        //Get rid of strange tags or equal signs
        el = el.replace(/\<([^\>]*)\>|([\s\S]*)\=/gm, '');
        //Get rid of some non-word characters
        el = el.replace(/[^\w\s\'\,(áéíóú)]|\d/gm, '');
        //Put the clean element back inside the array
        array[i] = el.trim().toLowerCase();
    });
    array.forEach((el, i) => {
        if (el === '' || el === "" || el === '.' || el === ',')
            array.splice(i,1);
    });
    return array;
}


//Sorts out all the possible syntactic types for a given word
export async function sortTypes(word) {
    const nn_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is "${word}" a noun?\r\n`
        + "(answer with yes/no)\r\n",
        max_tokens: 5
    });

    const vb_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is "to ${word}" a valid verb?\r\n`
        + "(answer with yes/no)\r\n",
        max_tokens: 5
    });

    const adj_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is "${word}" an adjective?\r\n`
        + "(answer with yes/no)\r\n",
        max_tokens: 5
    });

    const adv_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is "${word}" an adverb?\r\n`
        + "(answer with yes/no)\r\n",
        max_tokens: 5
    });

    const prep_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is "${word}" a preposition?\r\n`
        + "(answer with yes/no)\r\n",
        max_tokens: 5
    });

    const pron_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is "${word}" a pronoun?\r\n`
        + "(answer with yes/no)\r\n",
        max_tokens: 5
    });

    let types = [];
    await Promise.all([nn_p, vb_p, adj_p, adv_p, prep_p, pron_p])
    .then(([nn_r, vb_r, adj_r, adv_r, prep_r, pron_r]) => {
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
        if (pron_r.data.choices[0].text.toLowerCase().includes("yes"))
            types.push("pronoun");
    });
    return types;
}


//POR HACER
//Implementar esta funcion para que se añadan las combinaciones al documento de la palabra
export function makeCombinations(text) {
    let words = text.split(/\s/gm);
    let combinations = [];
    words.forEach((word, i) => {
        words.forEach((copy, j) => {
            if (i<j)
                combinations.push(`${word} ${copy}`);
        });
    });
    console.log(combinations);
    console.log(combinations.length);
    return combinations;
}


//Execute all the above code
makeCombinations("you can lead a horse to water but you can't make him drink");