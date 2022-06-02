import fetch from "node-fetch";

//  Calls any of your cloud functions and returns its response
export async function callCloudFunction(name, data) {
  let response = new Response();
  //response.data.contents = new WordDocument(data);
  const url = `https://europe-west1-candle-9cfbb.cloudfunctions.net/${name}`;
  await fetch(url, {method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({"words": data})}
    )
      .then(async (res) => {
        const body = await res.text();
        response.data = JSON.parse(body).data;
        console.log(response);
      })
      .catch((error) => {
        response.data.error = `ERROR CALLING CLOUD FUNCTION: ${error}`;
        response.data.errorCode = 7;
      });
  return response;
}

//  Constructor for the document object
export class WordDocument {
    //  Fields
  
    //  Constructor
    constructor(words) {
      this.words=words;
      this.wordCount=words.split(/\s/gm).length;
      this.types=[];
      this.meanings=[];
      this.synonyms=[];
      this.translations=[];
      this.examples=[];
      this.combinations=[];
    }
  }
  
  
  //  Constructor for the response object
  export class Response {
    constructor() {
      this.data=new Data();
    }
  }
  
  
  export class Data {
    constructor() {
      this.contents=null;
      this.error="";
      this.errorCode=-1;
      this.exactMatch=false;
    }
  }

callCloudFunction("dictionaryGenerator", "sift through");