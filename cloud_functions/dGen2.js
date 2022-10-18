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

//  POR HACER: Borrar esto
var rawDoc;

//  Main function, executes everything else
export async function init(words) {
    //  Correct the words in the document
    words = cleanText(words);

    //  Parse the request JSON into a document object
    let document = new WordDocument(words);
    
    //POR HACER: Borrar esto
    rawDoc = new WordDocument(words);

    //  Both checks if the request format is valid
    //  and creates a personalised response object
    let response = await errorHandler(document);

    //  Proceeds to populate the word document after
    //  having found no errors in the error handler
    if (response.errorCode === -1) {
        await populate(document);
    }

    //POR HACER: Borrar esto
    response.docs.push(rawDoc);

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
    const promises = [];
    const types_txt = document.types.join(", ");
    const varieties = [];

    //  POR HACER:      Hacer que GPT3 encuentre las variantes de palabra correspondientes a cada
    //                  tipo gramatical de una palabra concreta, utilizando distintos sufijos.
    //  POR HACER:      Refinar el 'prompt' que hago a OpenAI en isType() para que no me ni falsos
    //                  positivos ni falsos negativos para los tipos gramaticales de una palabra.
    //  POR HACER:      Solucionar los problemas que aparecen en el documento word 'Casuistica regex.odt'


    //  GPT3 generates meanings corresponding to each gramatical type your word has
    const meaningsPromise = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Write the 2 most common definitions for "${document.words}", `
            + `for each of these gramatical types: ${types_txt}\r\n`
            + "(don't write examples, the definitions"
            + " must be elaborate, use ';' as separator)",
        frequency_penalty: 1.7, 
        max_tokens: 350
    });
    promises.push(meaningsPromise);

    //  GPT3 creates a response with 5 spanish translations for your word
    const translationsPromise = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Translate "${document.words}" into Spanish, offer 3 translations `
            + `for each of these gramatical types: ${types_txt}\r\n`
            + "(use ';' as separator)\r\n",
        temperature: 0.3,
        presence_penalty: 1.7,
        max_tokens: 350
    });
    promises.push(translationsPromise);

    //  GPT3 creates a response with 3 synonyms for each gramatical type of your word
    const synonymsPromise = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Write 3 synonyms for "${document.words}", `
            + `for each of these gramatical types: ${types_txt}\r\n`
            + "(use ';' as separator)\r\n",
        presence_penalty: 1.9,
        max_tokens: 350
    });
    promises.push(synonymsPromise);

    //  GPT3 creates a response with 3 antonyms for each gramatical type of your word
    const antonymsPromise = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Write 3 antonyms for "${document.words}", `
            + `for each of these gramatical types: ${types_txt}\r\n`
            + "(use ';' as separator)\r\n",
        temperature: 0.9,
        presence_penalty: 1.9,
        max_tokens: 350
    });
    promises.push(antonymsPromise);

    //  GPT3 creates a response with 3 phrase examples for your word
    const examplesPromise = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Write 2 example phrases with "${document.words}" `
            + `for each of these gramatical types: ${types_txt}`
            + "(use ';' as separator)\r\n",
        frequency_penalty: 1.9,
        max_tokens: 500,
    });
    promises.push(examplesPromise);

    //  GPT3 writes the plural of your word, if there is one
    if (document.types.some(type => /(pro)?noun|verb|idiom/.test(type))) {
        promises.push(findPlural(document.words));
    }

    //  This executes all the above promises asynchronously so they complete in parallel
    await Promise.all([...promises])
    .then((results) => {

        //  Convert the meanings response text to an array
        const meanings_txt = results[0].data.choices[0].text;
        const meanings = splitByTypes(meanings_txt, document.types);

        //  Convert the translations response text to an array
        const translations_txt = results[1].data.choices[0].text;
        const translations = splitByTypes(translations_txt, document.types);
        
        //  Convert the synonyms response text to an array
        const synonyms_txt = results[2].data.choices[0].text;
        const synonyms = splitByTypes(synonyms_txt, document.types);

        //  Convert the antonyms response text to an array
        const antonyms_txt = results[3].data.choices[0].text;
        const antonyms = splitByTypes(antonyms_txt, document.types);

        //  Convert the examples response text to an array
        const examples_txt = results[4].data.choices[0].text;
        const examples = splitByTypes(examples_txt, document.types);
        examples.forEach((example,i) => {
            //  This code below is regex pruning specific to example responses
            example = example.charAt(0).toUpperCase() + `${example.slice(1)}.`;
            examples[i] = example;
        });

        //  Store the singular and plural in the document, if there is the case
        if (results[5] !== undefined) {
            let singularThenPlural = results[5];
            document.words = singularThenPlural[0];
            document.plural = singularThenPlural[1];
        }

        //  Generate word varieties for each gramatical type and fill them with
        //  the content from the GPT3 responses, then store all into the document 
        document.types.forEach(type => {
            let variety = new WordVariety(type);
            variety.meanings.push(...sortByType(meanings, type));
            variety.translations.push(...sortByType(translations, type));
            variety.synonyms.push(...sortByType(synonyms, type));
            variety.antonyms.push(...sortByType(antonyms, type));
            variety.examples.push(...sortByType(examples, type));
            varieties.push(variety);
        });
    
        document.varieties = varieties;

        //  POR HACER: Borra esto
        rawDoc.types = document.types;
        rawDoc.plural = document.plural;
        let raw = new WordVariety("raw");
        raw.meanings.push(meanings_txt);
        raw.translations.push(translations_txt);
        raw.synonyms.push(synonyms_txt);
        raw.antonyms.push(antonyms_txt);
        raw.examples.push(examples_txt);
        rawDoc.varieties.push(raw);
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
    let n='', to=''; 
    if (type === "verb" && words.split(/\s/gm).length > 1) {
        to = "to";
    }
    else if (/[aei]/i.test(type.charAt(0))) {
        n = "n";
    }
    return openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is ${to} "${words}" frequently used as a${n} ${type}?\r\n`
        + "(yes/no)\r\n",
        max_tokens: 10
    });
}


//  Makes an array of gramatically typed word information 
//  elements from the response text coming from GPT3 (the word
//  information could be whatever: translations, synonyms, etc...)
export function splitByTypes(text, types) {
    let array = [];
    let merger = [];
    let typesTxt= "";
    //  typesTxt = "noun|nombre|sustantivo|verbo?|adjec?tiv[eo]|adverbi?o?|pronoun|pronombre|"
    //      + "preposi[ct]i[oó]n|conjunct?i[oó]n|interjec[tc]i[oó]n|idiom|modismo|expresi[oó]n";
    types.forEach(type => {
        if (type === "noun") {
            typesTxt = typesTxt.concat("noun|nombre|sustantivo|");
        } else if (type === "verb") {
            typesTxt = typesTxt.concat("verbo?|");
        } else if (type === "adjective") {
            typesTxt = typesTxt.concat("adjec?tiv[eo]|");
        } else if (type === "adverb") {
            typesTxt = typesTxt.concat("adverbi?o?|");
        } else if (type === "pronoun") {
            typesTxt = typesTxt.concat("pronoun|pronombre|");
        } else if (type === "preposition") {
            typesTxt = typesTxt.concat("preposi[ct]i[oó]n|");
        } else if (type === "conjunction") {
            typesTxt = typesTxt.concat("conjunct?i[oó]n|");
        } else if (type === "interjection") {
            typesTxt = typesTxt.concat("interjec[tc]i[oó]n|");
        } else if (type === "idiom") {
            typesTxt = typesTxt.concat("idiom|modismo|expresi[oó]n|");
        }     
    });
    typesTxt = typesTxt.replace(/\|$/im, '');

    //  NOTE: You have to be careful with the regex you put into the test() method, as it can have faulty behavior:
    //  https://stackoverflow.com/questions/9275372/javascript-regex-should-pass-test-but-appears-to-fail-why
    //  https://stackoverflow.com/questions/1520800/why-does-a-regexp-with-global-flag-give-wrong-results
    //
    //  "It boils down to the fact that the test method of javascript regular expressions returns a result 
    //  and moves a pointer on to the index after the match." --> Removing the letter 'g' solves the problem
    //  because then the regex doesn't evaluate iteratively each time the lastIndex property changes
    const splitRegex = new RegExp(`\\(?(${typesTxt})\\)?\\:?`, "im");
    const typesRegex = new RegExp(`${typesTxt}`, "im");

    //  When the structure of the response comes out weird, we do this
    const weirdRegex = new RegExp(`((${typesTxt});\\s?)+`, "im");
    if (!splitRegex.test(text) || weirdRegex.test(text)) {
        text = text.replace(weirdRegex, '');
        array = cleanArray(text.split(/(\r?\n)+|\r+|\n+/im));
        array.forEach((el, i) => {
            let contents = cleanArray(el.split(/\W*\d\W*|\;\s?/gim));
            contents.forEach(content => {
                //  We store the merged content into another array
                merger.push(`${content} (${types[i]})`);
            });
        });
        return merger;
    }

    //  Array with content and types split apart 
    //  (Explanation: The method split() captures both the information between separators and
    //   also the separators themselves if you wrap the regex expression up in capture group
    //   parentheses, like this: /(regex_whatever)/ ...even more, split() creates an array
    //   in which its elements appear in the same order as the original text occurrences)
    array = cleanArray(text.split(splitRegex));

    //  Code to merge the content with its corresponding type
    array.forEach((element, i) => {
        if (i < array.length-1 && i%2 === 0) {
            //  We find both which element has the contents and which element is the separator
            //  using a ternary operator where the condition is testing if the array elements
            //  match a regex pattern looking for the gramatical types' words
            let type = (typesRegex.test(element) ? element : array[i+1]);
            let content = (array.indexOf(type)%2 === 0 ? array[i+1] : element);

            //  Then again we split once more the content of the current elements into smaller chunks,
            //   because in every GPT3 request I made each type has at least 2 different results
            let contents = cleanArray(content.split(/\W*\d\W*|\s{2,}|\;\s?/gim));
            contents.forEach(content => {
                //  We store the merged content into another array
                merger.push(`${content} (${type})`);
            });
        }
    });
    
    return merger;
}


//  Sorts which elements in an array of string elements
//  contain a certain gramatical type in parenthesis
export function sortByType(array, type) {
    const sortedElements = [];
    const regex = new RegExp(`\\s\\(${type}\\)`, "im");
    array.forEach(element => {
        if (regex.test(element)) {
            element = element.replace(regex, '');
            sortedElements.push(element);
        } 
    });
    return sortedElements;
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
    words = words.replace(/[^\w\s\'\,\;\(\)\?\!\/áéíóúñ]/gim, '');
    //  Gets rid of listing by letters (a, b, c, ...)
    words = words.replace(/^\w\s?$|^[b-hj-z]\s+/gim, '');
    //  Trim and lowercase the text
    words = words.trim().toLowerCase();
    //  Gets rid of parentheses with things in them
    //  words = words.replace(/\(.+\)?/, '');
    //  Gets rid of unnecessary English stuffing
    words = words.replace(/^and\s/gim, '');
    //  Gets rid of unnecessary Spanish stuffing
    words = words.replace(/^a |^([eé]l)?(l?a?o?s?) |^(m|t)(e|i) |^(t|s)(u|e) /gim, '')
        .replace(/|^n?os |^un[oa]? |^(nue|vue)str(a|o) | yo | (nos|vos)otros /gim, '');
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
init("semaphore");