// Import OpenAI client and filesystem modules
const { Configuration, OpenAIApi } = require("openai");
const fs = require("fs");
let openai = null;


function main() {
    //Set the API key to use the openai client
    const apiKey = fs.readFileSync('C:\\WS\\GoogleCloudFunctions\\Candle\\openai_api_key.txt', 'utf-8');
    const configuration = new Configuration({
        apiKey: apiKey,
    });
    openai = new OpenAIApi(configuration);

    //Get the request from the client
    const request_json = loadRequest();

    //Populate the word document
    createWord(request_json);
}


function loadRequest() {

    // Request coming from the search bar in the Candle app
    const request_object = {
        words: "draft",
        meanings: [],
        translations: [],
        synonyms: [],
        examples: []
    };

    // Load 5 meaning templates into the request object
    // (It's preferably if you do this in the client)
    for (let i = 0; i < 5; i++) { 
        var meaning = new Meaning();
        request_object.meanings.push(meaning);      
    }

    const request_json = JSON.stringify(request_object);
    return request_json;
}

//Constructor for a meaning object
function Meaning() {
    this.definition = "";
    this.type = "";
}


// Creates all the data necessary in JSON format
// to create a word document later in Firestore.
/* ---- STEPS TO TAKE: ----
1)      Ask if the input is a valid english word or phrase 
        (the number of words contained in the input will be parsed in the client.)
2.1)    If it's 1 word, ask if it's a noun or a verb.
2.2)    If it's more than 1 word, first ask if it's gramatically correct. 
        Then ask if it's an idiom.
        If not ask if it's a verb or a phrase.
4)      Ask for a meaning of that word/phrase.
5)      Ask for an example of that word/phrase. */
async function createWord(request) {
    var document = JSON.parse(request);
    const wordsCount = document.words.split(/\s/).length;
    const isValidWord = await checkWord(document.words);
    if (wordsCount === 1 && isValidWord) {
        await populate(document);
        console.log(JSON.stringify(document));
    }
}


// Checks if a given input is a valid word in the english dictionary.
async function checkWord(word) {  
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


//Fills the document object with meanings for the word or phrase
async function populate(document) {

    //DO THIS PART ASYNCHRONOUSLY...

    //GPT3 creates a response with the 5 most common meanings for your word
    const mean_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `These are the 5 most common meanings for '${document.words}':\r\n`
        + "(do not repeat the same phrase twice)\r\n" + "1.",
        max_tokens: 200
    });

    //GPT3 creates a response with 10 spanish translations for your word
    const tran_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `These are 10 synonyms for '${document.words}' in Spanish, separated by commas:\r\n`,
        max_tokens: 100
    });

    //GPT3 creates a response with 10 synonyms for your word
    const syn_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `These are 10 synonyms for '${document.words}', separated by commas:\r\n`,
        max_tokens: 100
    });

    //GPT3 creates a response with 3 phrase examples for your word
    const ex_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Write 3 phrases with '${document.words}' and a lenght of 10 words or more:\r\n1.`,
        temperature: 0.9,
        max_tokens: 150
    });

    //This executes all the above promises asynchronously so they complete in parallel
    await Promise.all([mean_p, tran_p, syn_p, ex_p])
    .then(([r_mean, r_tran, r_syn, r_ex]) => {
        //Convert the meanings response text to an array
        var meanings_txt = `1.${r_mean.data.choices[0].text}`;
        var meanings = meanings_txt.split(/\d../);
        //Convert the translations response text to an array
        var translations_txt = r_tran.data.choices[0].text;
        var translations = translations_txt.split(/,/);
        translations.forEach((tr, i) => {translations[i] = tr.replace(/\r?\n|\r|^\s+/gm, '').toLowerCase();});
        //Convert the synonyms response text to an array
        var synonyms_txt = r_syn.data.choices[0].text;
        var synonyms = synonyms_txt.split(/,/);
        synonyms.forEach((syn, i) => {synonyms[i] = syn.replace(/\r?\n|\r|^\s+/gm, '').toLowerCase();});
        //Convert the examples response text to an array
        var examples_txt = r_ex.data.choices[0].text;
        var examples = examples_txt.split(/\d../)
        examples.forEach((ex, i) => {examples[i] = ex.replace(/\r?\n|\r|^\s+/gm, '');});
        //Store the meanings into the document object    
        //document.meanings.push(...meanings); //This line is WRONG, the elements of this array are not 'Meaning objects'
        document.translations.push(...translations);
        document.synonyms.push(...synonyms);
        document.examples.push(...examples);
    });
}


//Execute all the above code
main();