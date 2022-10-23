import { Configuration, OpenAIApi } from "openai";


//  Set the API key to use the openai client
const configuration = new Configuration({
    //  Remember setting up the 'OPENAI_API_KEY' environment variable with its
    //  value equal to the API key both in your local and GCF's environment variables:
    //  (In case of the local system, you have to reboot in order for the env_var to appear)
    apiKey: process.env.OPENAI_API_KEY,
});
let openai = new OpenAIApi(configuration);


//  Constructor for the response object
export class WordResponse {
    //  Constructor
    constructor() {
      this.docs=[];
      this.error="";
      this.errorCode=-1;
      this.exactMatch=false;
    }
}


//  Constructor for the document object
export class WordDocument {
    constructor(words) {
        this.words=words;
        this.wordCount=words.split(/\s/gm).length;
        this.plural="";
        this.types=[];
        this.varieties=[];
        this.imageUrl="";
    }
}

export class WordVariety {
    constructor(type) {
        this.type=type;
        this.meanings=[];
        this.translations=[];
        this.synonyms=[];
        this.antonyms=[];
        this.examples=[];
        this.variants=[];
    }
}


//  Google Cloud functions entry point
//  (not relevant in local execution)
export async function entryPoint(req, res) {
    let words = req.body.words || "";
    await init(words).then(wres => {
      res.status(200).send(wres);
    });
}

//  Main function, executes everything else
export async function init(words) {
    //  Correct the words in the document
    words = cleanText(words);

    //  Parse the request JSON into a document object
    let document = new WordDocument(words);

    //  Both checks if the request format is valid
    //  and creates a personalised response object
    let response = await errorHandler(document);

    //  Proceeds to populate the word document after
    //  having found no errors in the error handler
    if (response.errorCode === -1) {
        await populate(document);
    }

    //  Finally we push the document object into the response,
    //  wether it is populated or it is not (due to an error)
    response.docs.push(document);

    // (LOCAL: log the response in the terminal)
    const txt = JSON.stringify(response);
    console.log(txt);

    return response;
}


//  Checks wether a word or a phrase is a valid one
export async function errorHandler(document) {
    let response = new WordResponse();
    const charCount = document.words.length;
    if (document.words !== "" && document.wordCount <= 13 && charCount <= 130) {
        //  First we check if each given word is valid
        const promises = [];
        let allWordsValid = true;
        const words = document.words.split(/\s/gim);
        words.forEach(word => {
            word = word.replace(/'([\s\S]*)$/gim, '')
            promises.push(checkWord(word));
        });

        await Promise.all(promises)
        .then(results => {
          results.find(result => {
            if (!result) {
              response.error = "Invalid word found."
              response.errorCode = 1;
              allWordsValid = false;
              return true;
            }
            return false;
          });
        });

        if (allWordsValid) {
            //  Sort all the possible gramatical types
            //  first, wether it be a word or a phrase
            const types = await findTypes(document.words);
            document.types.push(...types);

            //  Then if there are no types inside the array,
            //  it's because we have an invalid phrase
            if (document.wordCount > 1 && types.length < 1) {
                response.error = "Invalid phrase combination: "
                    + "It is neither an idiom, verb, or noun.";
                response.errorCode = 2;
            }
        }
    }
    else if (document.words === "") {
        response.error = "Empty request.";
        response.errorCode = 3;
    }
    else if (document.wordCount > 13 || charCount > 130) {
        response.error = "Limit of 13 words or 130 characters exceeded";
        response.errorCode = 4;
    }
    else {
        response.error = "Invalid request format.";
        response.errorCode = 5;
    }
    return response;
}


// Checks if a given input is a valid word in the english dictionary.
export async function checkWord(word) {  
    const answer = await openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is "${word}" an english word?:\r\n`
        + "(yes/no)\r\n",
        max_tokens: 5
    });
    return answer.data.choices[0].text.toLowerCase().includes("yes");
}


//  Fills the document object with meanings for the word or phrase
export async function populate(document) {
    const types = document.types;
    const typesTxt = types.join(", ");
    const promises = [];
    const varieties = [];

    //  POR HACER:      Hacer que GPT3 encuentre las variantes de palabra correspondientes a cada
    //                  tipo gramatical de una palabra concreta, utilizando distintos sufijos.
    //  POR HACER:      Refinar el 'prompt' que hago a OpenAI en isType() para que no me ni falsos 
    //                  positivos ni falsos negativos para los tipos gramaticales de una palabra.

    types.forEach(type => {
        const array = [];

        //  GPT3 generates meanings corresponding to each gramatical type your word has
        const meaningsAndExamplesPromise = openai.createCompletion("text-davinci-002", 
        {
            prompt: `Write the 3 most common definitions for the ${type} "${document.words}", `
                + "along with an example phrase\r\n(definitions must be elaborate and long)\r\n"
                + "(use 'ex:' to separate definitions from examples)\r\n1. ",
            frequency_penalty: 1.9, 
            max_tokens: 500
        });
        array.push(meaningsAndExamplesPromise);

        //  GPT3 creates a response with 5 spanish translations for your word
        const translationsPromise = openai.createCompletion("text-davinci-002", 
        {
            prompt: `Write 5 ${type}s with the meaning of "${document.words}" in Spanish:\r\n1. "`, 
            temperature: 0.4,
            presence_penalty: 2.0,
            max_tokens: 350
        });
        array.push(translationsPromise);

        //  GPT3 creates a response with 3 synonyms for each gramatical type of your word
        const synonymsPromise = openai.createCompletion("text-davinci-002", 
        {
            prompt: `Write 5 ${type}s that are synonyms for "${document.words}":\r\n1. `,
            presence_penalty: 1.9,
            max_tokens: 350
        });
        array.push(synonymsPromise);

        //  GPT3 creates a response with 3 antonyms for each gramatical type of your word
        const antonymsPromise = openai.createCompletion("text-davinci-002", 
        {
            prompt: `Write 5 ${type}s that are antonyms for "${document.words}":\r\n1. `,
            presence_penalty: 1.9,
            max_tokens: 350
        });
        array.push(antonymsPromise);

        //  POR HACER: Escribe un prompt válido para que se rellenen las variantes.
        if (/[nav]/im.test(type.charAt(0)) && document.wordCount === 1) {
            const variantsPromise = openai.createCompletion("text-davinci-002", 
            {
                prompt: `Make valid ${type}s by adding suffixes to "${document.words}"\r\n`
                    + "(use ';' as separator)\r\n",
                presence_penalty: 1.9,
                max_tokens: 350
            });
            array.push(variantsPromise);
        }

        promises.push(Promise.all([...array]));
    });

    //  GPT3 writes the plural of your word, if there is one
    if (document.types.some(type => /(pro)?noun|verb|idiom/.test(type))) {
        promises.push(findPlural(document.words));
    }

    //  This executes all the above promises asynchronously so they complete in parallel
    await Promise.all([...promises])
    .then((results) => {
        //  Store the singular and plural in the document, if there is the case
        if (promises.length > types.length) {
            let singularThenPlural = results[results.length-1];
            document.words = singularThenPlural[0];
            document.plural = singularThenPlural[1];
        }

        //  Generate word varieties for each gramatical type and fill them with the
        //  content from the GPT3 responses, then store all varieties into the document 
        types.forEach((type, i) => {
            const variety = new WordVariety(type);
            const result = results[i];

            //  Converts the meanings and examples response text to arrays
            const meaningsAndExamplesTxt = result[0].data.choices[0].text;
            const meaningsAndExamples = cleanArray(meaningsAndExamplesTxt.split(/\d\W?/im));
            const meanings = [], examples = [];
            meaningsAndExamples.forEach(pair => {
                let splitRegex = new RegExp("(eg|(for\s)?ex(ample)?)[\:\,]", "im");
                const meaningAndExample = cleanArray(pair.split(splitRegex));

                let meaning = meaningAndExample[0].trim();
                meanings.push(meaning);

                let example = meaningAndExample[meaningAndExample.length-1].trim();
                example = example.charAt(0).toUpperCase() + `${example.slice(1)}.`;
                examples.push(example);
            });
            variety.meanings.push(...meanings);
            variety.examples.push(...examples);

            //  Convert the translations response text to an array
            const translationsTxt = result[1].data.choices[0].text;
            const translations = cleanArray(translationsTxt.split(/\d\W?/im));
            variety.translations.push(...translations);
            
            //  Convert the synonyms response text to an array
            const synonymsTxt = result[2].data.choices[0].text;
            const synonyms = cleanArray(synonymsTxt.split(/\d\W?/im));
            variety.synonyms.push(...synonyms);

            //  Convert the antonyms response text to an array
            const antonymsTxt = result[3].data.choices[0].text;
            const antonyms = cleanArray(antonymsTxt.split(/\d\W?/im));
            variety.antonyms.push(...antonyms);

            //  POR HACER: Codigo para incluir las variantes dentro de una variety.
            if (result[4] !== undefined) {
                const variantsTxt = result[4].data.choices[0].text;
                const variants = cleanArray(variantsTxt.split(/\;/im));
                variety.variants.push(...variants);
            }

            varieties.push(variety);
        });  

        document.varieties = varieties;
    });
}


//  Finds all the possible syntactic types for a given word
export async function findTypes(words) {
    let types = [];
    let validTypes = [];
    let promises = [];
    let wordCount = words.split(/\s/gm).length;

    //  GPT3 checks wether your word or phrase is a noun
    promises.push(isType(words, "noun"));
    types.push("noun");
    //  GPT3 checks wether your word or phrase is a verb
    promises.push(isType(words, "verb"));
    types.push("verb");

    //  One-Words only
    if (wordCount === 1) {
        //  GPT3 checks wether your word is an adjective
        promises.push(isType(words, "adjective"));
        types.push("adjective");
        //  GPT3 checks wether your word is an adverb
        promises.push(isType(words, "adverb"));
        types.push("adverb");
        //  GPT3 checks wether your word is a pronoun
        promises.push(isType(words, "pronoun"));
        types.push("pronoun");
        //  GPT3 checks wether your word is a preposition
        promises.push(isType(words, "preposition"));
        types.push("preposition");
    }

    //  Phrases only
    if (wordCount > 1) {
        //  GPT3 sorts out wether a group of words is an idiom
        promises.push(isType(words, "idiom"));
        types.push("idiom");
    }

    await Promise.all(promises)
    .then(async(responses) => {
        responses.forEach((response, i) => {
            //  If the response from GPT3 says that any type is not
            //  valid, we simply remove it from the types array
            if (response.data.choices[0].text.toLowerCase().includes("yes")) {
                validTypes.push(types[i]);
            }
        });

        //  Only after having checked that the word or phrase does not belong to
        //  the main gramatical types listed above, then we start to check
        //  other alternative and less common gramatical types
        if (types.length === 0 && wordCount === 1) {
            promises = [];
            //  GPT3 checks wether your word is a conjuction
            promises.push(isType(words, "conjuction"));
            types.push("conjuction");
            //  GPT3 checks wether your word is an interjection
            promises.push(isType(words, "interjection"));
            types.push("interjection");

            await Promise.all(promises)
            .then(responses => {
                responses.forEach((response, i) => {
                    if (response.data.choices[0].text.toLowerCase().includes("yes")) {
                        validTypes.push(types[i]);
                    }
                });
            });
        }
    });

    return validTypes;
}


//  Sends a request to OpenAI asking if a given
//  gramatical type is valid for our word
export function isType(words, type) {
    let to=''; 
    if (type === "verb" && words.split(/\s/gm).length > 1) {
        to = "to";
    }
    return openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is ${to} "${words}" a valid ${type}?\r\n`
        + "(yes/no)\r\n",
        max_tokens: 10
    });
}


//  Cleanses the text of all elements of an array of string elements
export function cleanArray(array) {
    //  First of all we make sure to erase all
    //  empty or undefined elements from the array
    array = array.filter(element => {
        return element !== undefined && element !== null && /\w/mi.test(element)
    });
    array.forEach((el, i) => {
        //  Correct the text inside of a given element
        el = cleanText(el);
        //  Put the clean element back inside the array
        array[i] = el;
    });
    return array;
}


//  Uses regexes to clean any given text coming
//  either from a user request or an OpenAI response
export function cleanText(words) {
    //  Fuse a multiline string into a single line
    words = words.replace(/(\r?\n)+|\r+|\n+|\t+/gim, "  ");
    //  Eliminate all duplicate consecutive words except one
    words = words.replace(/\b(\w+)(?=\W\1\b)+\W?/gim, "");
    //  Gets rid of strange tags or equal signs
    words = words.replace(/\<([^\>]*)\>|([\s\S]*)\={1,}/gim, '');
    //  Gets rid of some non-word characters and
    //  parentheses at the beginning or end of the text
    words = words.replace(/[^\w\s\'\,\:\;\(\)\?\!\/áéíóúñ]/gim, '');
    //  Gets rid of listing by letters (a, b, ...) and ':' at the end
    words = words.replace(/^\w\s?$|^[b-hj-z]\s+|\:$/gim, '');
    //  Trim and lowercase the text
    words = words.trim().toLowerCase();
    //  Gets rid of parentheses with things in them
    //  words = words.replace(/\(.+\)?/, '');
    //  Gets rid of unnecessary English stuffing
    words = words.replace(/^and\s/gim, '');
    //  Gets rid of unnecessary Spanish stuffing
    words = words.replace(/^([eé]l)?(l?a?o?s?) |^(m|t)(e|i) |^(t|s)(u|e) /gim, '')
        .replace(/|^n?os |^un[oa]? |^(nue|vue)str(a|o) | yo | (nos|vos)otros |\/\w+/gim, '');
    return words;
}


//  Finds the plural of your word, if there is one
export async function findPlural(words) {
    const pluralPromise = await openai.createCompletion("text-davinci-002", 
    {
        prompt: `Write the singular and plural for "${words}"\r\n`
            + "singular: ",
        max_tokens: 100
    });

    let plural_txt = pluralPromise.data.choices[0].text;
    const splitRegex = new RegExp(`singular:\s?|plural:\s?`, "gim");
    return cleanArray(plural_txt.split(splitRegex));
}


//  Makes all the possible combinations of 2 words within a
//  given text, it is used for querying words in firestore
export function makeCombinations(text) {
    let words = text.split(/\s/gm);
    let combinations = [];
    words.forEach((word, i) => {
        words.forEach((copy, j) => {
            if (i<j && i<5)
                combinations.push(`${word} ${copy}`);
        });
    });
    return combinations;
}


//  Execute all the above code
init("like");