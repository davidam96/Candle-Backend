// Import OpenAI client
const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({
  apiKey: "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",
});
const openai = new OpenAIApi(configuration);


// Request coming from the search bar in the Candle app
const request_object = {
    words: "draft",
    num_words: 1,
    meanings: []
};
const request_json = JSON.stringify(request_object);


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
    if (document.num_words === 1) {
        let word = document.words;
        let isValid = await isValidWord(word);
        if (isValid) {
            var newDocument = document;
            newDocument = await populate(document);
        }        
    }
}


// Checks if a given input is a valid word in the english dictionary.
async function isValidWord(word) {  
    const answer = await openai.createAnswer({
        model: "davinci",
        question: `Is ${word} an english word?`,
        examples_context: "English words: dog, cat, phone, joy, ...",
        examples: [["Is 'dog' an english word?", "Yes"],
                  ["Is 'asdafsaf' an english word?", "No"]],
        documents: [],
        max_tokens: 1
    });
    console.log("DOES THE WORD EXIST: " + answer.data.answers[0] + "\n\n");
    if (answer.data.answers !== null && 
        answer.data.answers[0].toLowerCase().includes("yes"))
        return true;
    return false;
}


//Fills the document object with meanings for the word or phrase
async function populate(document) {

    //Create a text with the 5 most common meanings
    const completion = await openai.createCompletion("text-davinci-002", 
    {
        prompt: `These are the 5 most common meanings for '${document.words}':\r\n`
        + "(do not repeat the same phrase twice)\r\n" + "1.",
        max_tokens: 200
    });

    //Convert the meanings text to an array
    var meanings_text = `1.${completion.data.choices[0].text}`;  
    var meanings = meanings_text.split(/\d../);
    
    console.log(meanings_text);

    //Store those meanings into the document object
    meanings.forEach((m, i) => {
        var meaning = new Meaning();
        meaning.definition = m;
        meaning.number = i;
        document.meanings.push(meaning);
    });
}


//Constructor for a meaning object
function Meaning() {
    this.definition = ""; //filled
    this.type = "";
    this.number = 0; //filled
    this.translations = [];
    this.synonyms = [];
    this.examples = [];
}

//Execute all the above code
createWord(request_json);