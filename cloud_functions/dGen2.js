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
    constructor(type, words) {
        this.type=type;
        this.words=words||"";
        this.meaning="";
        this.translations=[];
        this.synonyms=[];
        this.antonyms=[];
        this.examples=[];
    }
}


//  Google Cloud functions entry point (not relevant in local execution)
export async function dictionaryGenerator(req, res) {
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

    //  Proceeds to populate the word document
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
    if (document.words === "") {
        response.error = "Empty request.";
        response.errorCode = 0;
    }
    else if (document.wordCount === 1 && charCount <= 30) {
        let isValidWord = await checkWord(document.words);
        if (!isValidWord) {
            response.error = "Invalid word.";
            response.errorCode = 1;
        }
    }
    else if (document.wordCount > 1 && document.wordCount <= 13 && charCount <= 130) {
        //  First we check if each given word in the phrase is valid
        let allWordsAreValid = true;
        const words = document.words.split(/\s/gm);
        const promises = [];
        words.forEach(word => {
            word = word.replace(/'([\s\S]*)$/gm, '')
            promises.push(checkWord(word));
        });
        await Promise.all(promises)
        .then(results => {
          results.find(result => {
            if (!result) {
              response.error = "The phrase contains an invalid word."
              response.errorCode = 2;
              allWordsAreValid = false;
              return true;
            }
            return false;
          });
        });
        //  Then, if all words in the phrase are valid, we check and
        //  correct the phrase gramatically and assign it its type.
        if (allWordsAreValid) {
            let isValidPhrase = await checkPhrase(document);
            //  We retry a second time
            if (!isValidPhrase) {
                isValidPhrase = await checkPhrase(document);
            }            
            if (!isValidPhrase) {
                response.error = "Invalid phrase. It's neither an idiom nor a verb";
                response.errorCode = 3;
            }
        }
    }
    else if (document.wordCount > 13) {
        response.error = "Limit of 13 words exceeded";
        response.errorCode = 4;
    }
    else if (charCount > 130) {
        response.error = "Limit of 130 characters exceeded";
        response.errorCode = 5;
    }
    else {
        response.error = "Invalid request format.";
        response.errorCode = 6;
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


//  Checks if a given group of words are a valid idiom or verb. In case
//  they are not, it corrects it and tries with the correction instead
export async function checkPhrase(document) {  

    let isValidPhrase = false;

    //  GPT3 sorts out wether a group of words is an idiom
    const idm_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is "${document.words}" an idiom?:\r\n`
        + "(yes/no)\r\n",
        max_tokens: 5
    });

    //  GPT3 sorts out wether a group of words is a verb
    const vb_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is "to ${document.words}" a valid verb?:\r\n`
        + "(yes/no)\r\n",
        max_tokens: 5
    });

    //  GPT3 sorts out wether a group of words is a noun
    const nn_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is "${document.words}" a noun?:\r\n`
        + "(yes/no)\r\n",
        max_tokens: 5
    });

    //  Fills the word type and returns true if the
    //  phrase is wether an idiom, a verb or both.
    await Promise.all([idm_p, vb_p, nn_p])
    .then(([idm_r, vb_r, nn_r]) => {
        const isIdiom = idm_r.data.choices[0].text.toLowerCase().includes("yes");
        const isVerb = vb_r.data.choices[0].text.toLowerCase().includes("yes");
        const isNoun = nn_r.data.choices[0].text.toLowerCase().includes("yes");
        if (isIdiom)
            document.types.push("idiom");
        if (isVerb) 
            document.types.push("verb");
        if (isNoun) 
            document.types.push("noun");
        if (isIdiom || isVerb || isNoun)
            isValidPhrase = true;
    });
    return isValidPhrase;
}


//  Fills the document object with meanings for the word or phrase
export async function populate(document) {
    let promises = [];
    let types_txt = document.types.join(", ");
    let types_count = document.types.length;
    let varieties = []; 

    //  GPT3 sorts the possible syntactic types for a given word
    if (document.wordCount === 1) {
        const types = await sortTypes(document.words);
        document.types.push(...types);
    }
    //  Right after we create an array with all possible word varieties
    document.types.forEach(type => {
        let variety = new WordVariety(type, document.words);
        varieties.push(variety);
    });

    //  HECHO:          Comprobar si el codigo de generar meanings funciona o no.
    //  HECHO:          En algunos casos el texto de los meanings viene con el type entre parentesis, y además
    //                  luego en la propiedad 'meaning.type' el verdadero tipo que le deberia corresponder es otro.
    //                  Parece que esto es debido a una race condition, el codigo de debajo de hallar los meanings 
    //                  sigue ejecutandose, cuando deberia esperar a que este terminase primero.
    //  HECHO:          ¿Se pueden ejecutar las promesas que traen estos meanings en paralelo en vez de en serie?
    //                  Sí --> Promise.all() preserva el orden de las responses según el orden de las promesas.
    //  HECHO:          En algunos casos el texto de los meanings viene en blanco. (Solo ocurre en modo debug)
    //  POR HACER:      Unificar frases de ejemplo con los meanings de cada type. Hacerlo también si puede ser con
    //                  las traducciones, que sean específicas a cada type.
    //  POR HACER:      Hacer que GPT3 primero distinga si la palabra viene en plural o en singular,
    //                  y en función del resultado actuar en consecuencia en cada caso.
    //                  (el codigo de abajo y el metodo findPlural() están incompletos)


    //  GPT3 writes the plural of your word
    if (document.types.includes("noun")) {
        document.plural = await findPlural(document.words);
    }

    //  GPT3 generates meanings corresponding to each gramatical type your word has
    document.types.forEach(async (type) => {
        let n = "1", s = "";
        if (type === "noun" || type === "verb") {
            n = "2", s = "s";
        }
        const meanings = openai.createCompletion("text-davinci-002", 
        {
            prompt: `Write "${n}" common meaning"${s}" for "${document.words}" as "${type}"\r\n`
            + `(no examples)\r\n1. `,
            temperature: 0.7,
            max_tokens: 200
        });
        promises.push(meanings);
    });

    //  1) DEBO REORGANIZAR EL CODIGO AQUI DEBAJO PARA QUE INCLUYA LAS DEMAS PROMESAS PARA LAS
    //     RADUCCIONES, SINONIMOS, ANTONIMOS Y EJEMPLOS TIPADOS.
    //  2) LUEGO GUARDAR TODAS LAS PROMESAS CORRESPONDIENTES A UN TIPO DETERMINADO EN UN ARRAY DE
    //     PROMESAS.
    //  3) CREAR TANTOS ARRAY DE PROMESAS COMO TIPOS GRAMATICALES HAYA
    //  4) Y POR ULTIMO, SABIENDO QUE LA LONGITUD ES IGUAL PARA CADA UNO DE ESTOS ARRAYS, UTILIZAR
    //     ESTE HECHO A TU FAVOR LUEGO EN EL Promise.all()


    //  0) NO, ME HE EQUIVOCADO, LO QUE DEBO HACER ES ENCONTRAR UN MÉTODO DE PEDIRLE A GPT3 UNA MEZCLA
    //     CON VARIOS TYPES A LA VEZ EN EL TEXTO DE CADA PROMESA Y LUEGO PROCESARLO CON REGEX.
    // .....

    //  GPT3 creates a response with 5 spanish translations for your word
    const translations = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Write ${types_count*2} translations for "${document.words}" in Spanish,`
            + ` along with their gramatical types in parentheses:\r\n`
            +`(must use all of these: ${types_txt})\r\n1. `,
        temperature: 0.8,
        presence_penalty: 1.8,
        max_tokens: 200
    });
    promises.push(translations);

    //  GPT3 creates a response with 10 synonyms for your word
    const synonyms = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Write 5 synonyms for "${document.words}":\r\n`,
        temperature: 0.9,
        max_tokens: 200
    });
    promises.push(synonyms);

    //  GPT3 creates a response with 10 antonyms for your word
    const antonyms = openai.createCompletion("text-davinci-002", 
    {
        prompt: `What would be the opposite of "${document.words}"?`
        + `(just write 3 words or verbs that mean the contrary to "${document.words}")`,
        temperature: 0.7,
        max_tokens: 200
    });
    promises.push(antonyms);

    //  GPT3 creates a response with 3 phrase examples for your word
    const examples = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Write 3 phrases with "${document.words}":\r\n1.`,
        temperature: 0.9,
        max_tokens: 200
    });
    promises.push(examples);

    //  This executes all the above promises asynchronously so they complete in parallel
    await Promise.all([...promises])
    .then((results) => {
        //  Convert the meanings response text to an array
        let l = document.types.length - 1;
        results.forEach((_, i) => {
            if (i <= l) {
                let type = document.types[i];
                const meanings_txt = results[i].data.choices[0].text;
                let meanings = cleanArray(meanings_txt.split(/\d./gm));
                meanings.forEach(meaning => {
                    let wordType = new WordVariety(type, meaning);
                    document.types.push(wordType);
                }); 
            }
        });


        //  POR HACER:  OPTIMIZAR EL CODIGO DE AQUI ABAJO

        //  Convert the translations response text to an array
        const translations_txt = results[l+1].data.choices[0].text;
        let translations = cleanArray(translations_txt.split(/\d.|, /gm));
        translations.forEach(translation => {
            if (/\(.*idiom.*\)|\(.*expression.*\)/gmi.test(translation) ) {
                let variety = varieties.find(v => {
                    v.type = "idiom";
                });
                let index = varieties.indexOf(variety);
                variety.translations.push(translation);
                varieties[index] = variety;
            }
            else if (/\(.*verb.*\)/gmi.test(translation)) {
                let variety = varieties.find(v => {
                    v.type = "verb";
                });
                let index = varieties.indexOf(variety);
                variety.translations.push(translation);
                varieties[index] = variety;
            } 
            else if (/\(.*noun.*\)/gmi.test(translation)) {
                let variety = varieties.find(v => {
                    v.type = "noun";
                });
                let index = varieties.indexOf(variety);
                variety.translations.push(translation);
                varieties[index] = variety;
            }
            else if (/\(.*adjective.*\)/gmi.test(translation)) {
                let variety = varieties.find(v => {
                    v.type = "adjective";
                });
                let index = varieties.indexOf(variety);
                variety.translations.push(translation);
                varieties[index] = variety;
            }
            else if (/\(.*adverb.*\)/gmi.test(translation)) {
                let variety = varieties.find(v => {
                    v.type = "adverb";
                });
                let index = varieties.indexOf(variety);
                variety.translations.push(translation);
                varieties[index] = variety;
            }
            else if (/\(.*pronoun.*\)/gmi.test(translation)) {
                let variety = varieties.find(v => {
                    v.type = "pronoun";
                });
                let index = varieties.indexOf(variety);
                variety.translations.push(translation);
                varieties[index] = variety;
            }
            else if (/\(.*preposition.*\)/gmi.test(translation)) {
                let variety = varieties.find(v => {
                    v.type = "preposition";
                });
                let index = varieties.indexOf(variety);
                variety.translations.push(translation);
                varieties[index] = variety;
            }
            else if (/\(.*conjuction.*\)/gmi.test(translation)) {
                let variety = varieties.find(v => {
                    v.type = "preposition";
                });
                let index = varieties.indexOf(variety);
                variety.translations.push(translation);
                varieties[index] = variety;
            }
            else if (/\(.*interjection.*\)/gmi.test(translation)) {
                let variety = varieties.find(v => {
                    v.type = "interjection";
                });
                let index = varieties.indexOf(variety);
                variety.translations.push(translation);
                varieties[index] = variety;
            }
        });


        //  Convert the synonyms response text to an array
        const synonyms_txt = results[l+2].data.choices[0].text;
        let synonyms = cleanArray(synonyms_txt.split(/\d.|, /gm));
        //  Convert the antonyms response text to an array
        const antonyms_txt = results[l+3].data.choices[0].text;
        let antonyms = cleanArray(antonyms_txt.split(/\d.|, /gm));
        //  Convert the examples response text to an array
        const examples_txt = results[l+4].data.choices[0].text;
        let examples = cleanArray(examples_txt.split(/\d./gm));
        examples.forEach((example,i) => {
            example = example.charAt(0).toUpperCase() + `${example.slice(1)}.`;
            examples[i] = example;
        });
        document.translations.push(...translations);
        document.synonyms.push(...synonyms);
        document.antonyms.push(...antonyms);
        document.examples.push(...examples);
        document.combinations = makeCombinations(document.words);  
    });
}


//  Sorts out all the possible syntactic types for a given word
export async function sortTypes(word) {
    let types = [];

    const nn_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is "${word}" a noun?\r\n`
        + "(yes/no)\r\n",
        max_tokens: 5
    });
    const vb_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is "to ${word}" a valid verb?\r\n`
        + "(yes/no)\r\n",
        max_tokens: 5
    });
    const adj_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is "${word}" an adjective?\r\n`
        + "(yes/no)\r\n",
        max_tokens: 5
    });
    const adv_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is "${word}" an adverb?\r\n`
        + "(yes/no)\r\n",
        max_tokens: 5
    });
    const pron_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is "${word}" a pronoun?\r\n`
        + "(yes/no)\r\n",
        max_tokens: 5
    });
    const prep_p = openai.createCompletion("text-davinci-002", 
    {
        prompt: `Is "${word}" a preposition?\r\n`
        + "(yes/no)\r\n",
        max_tokens: 5
    });

    await Promise.all([nn_p, vb_p, adj_p, adv_p, pron_p, prep_p])
    .then(([nn_r, vb_r, adj_r, adv_r, pron_r, prep_r]) => {
        if (nn_r.data.choices[0].text.toLowerCase().includes("yes"))
            types.push("noun");
        if (vb_r.data.choices[0].text.toLowerCase().includes("yes"))
            types.push("verb");
        if (adj_r.data.choices[0].text.toLowerCase().includes("yes"))
            types.push("adjective");
        if (adv_r.data.choices[0].text.toLowerCase().includes("yes"))
            types.push("adverb");
        if (pron_r.data.choices[0].text.toLowerCase().includes("yes"))
            types.push("pronoun");
        if (prep_r.data.choices[0].text.toLowerCase().includes("yes"))
            types.push("preposition");
    });


    //  Only after having checked that the word does not belong to the
    //  main gramatical types listed above, then we start to check the
    //  other alternative and less common gramatical types.
    if (types.length === 0) {
        const conj_p = openai.createCompletion("text-davinci-002", 
        {
            prompt: `Is "${word}" a conjuction?\r\n`
            + "(yes/no)\r\n",
            max_tokens: 5
        });
        const inter_p = openai.createCompletion("text-davinci-002", 
        {
            prompt: `Is "${word}" an interjection?\r\n`
            + "(yes/no)\r\n",
            max_tokens: 5
        });

        await Promise.all([prep_p, conj_p, inter_p])
        .then(([conj_r, inter_r]) => {
            if (conj_r.data.choices[0].text.toLowerCase().includes("yes"))
                types.push("conjuction");
            if (inter_r.data.choices[0].text.toLowerCase().includes("yes"))
                types.push("interjection");
        });
    }

    return types;
}


//  Uses regexes to clean any given text coming
//  either from a user request or an OpenAI response
export function cleanText(words) {
    // --------  ORIGINAL CODE OF cleanText()  ---------
    //  Fuse a multiline string into a single line
    words = words.replace(/(\r?\n)+|\r+|\n+|\t+/gm, " ");
    //  Eliminate all duplicate consecutive words except one
    words = words.replace(/\b(\w+)(?=\W\1\b)+\W?/gm, "");


    // --------  FORMER CODE OF cleanArray()  ----------
    //  Get rid of some non-word characters & 'and' at beginning of text
    words = words.replace(/[^\w\s\'\,(áéíóúñ)]|\d|^(\s?and\s)/gmi, '');
    //  Get rid of strange tags or equal signs
    words = words.replace(/\<([^\>]*)\>|([\s\S]*)\=/gm, '');
    //  Trim and lowercase the text
    words = words.trim().toLowerCase();
    //  Get rid of spanish pronouns
    words = words.replace(/^el |^las? |^los |^una?/gmi, '');
    return words;
}


//  Cleanses the text of all elements of an array of string elements
export function cleanArray(array) {
    array.forEach((el, i) => {
        //  Correct the text inside of a given element
        el = cleanText(el);
        //  Put the clean element back inside the array
        array[i] = el;
    });
    array.forEach((el, i) => {
        if (el === '' || el === "" || el === '.' || el === ',')
            array.splice(i,1);
    });
    return array;
}


//  POR HACER:  Este codigo esta a medio hacer...
//  Finds the plural of your word, if there is one
export async function findPlural(words) {
    let plural = "";
    await openai.createCompletion("text-davinci-002", 
    {
        prompt: `Write the plural of "${words}":\r\n`,
        temperature: 0.5,
        max_tokens: 200
    }).then(result => {
        plural = cleanText(result.data.choices[0].text);
    });
    return plural;
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