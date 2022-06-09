import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import fetch from "node-fetch";
import Query = FirebaseFirestore.Query
import QuerySnapshot = FirebaseFirestore.QuerySnapshot
import DocumentData = FirebaseFirestore.DocumentData


//  Boot up Candle's firebase app and create
//  the database object to work with firestore
const firebase = admin.initializeApp();
const db = firebase.firestore();


//  Constructor for the response object
export class WordResponse {
  // Fields
  docs: Array<DocumentData>;
  error: string;
  errorCode: number;
  exactMatch: boolean;

  // Constructor
  constructor() {
    this.docs=[];
    this.error="";
    this.errorCode=-1;
    this.exactMatch=false;
  }
}


export const searchDictionary = functions.region("europe-west1")
    .https.onRequest(async (req, res) => {
      //  Parsing the request into an object
      const words: string = req.body.words || "";

      //  Creating a personalised response object and a documents array
      let wres = new WordResponse();
      let documents: Array<DocumentData> = [];

      //  If the search result matches exactly the result, we send
      //  a flag back to the client to implement a new functionality
      const perfectQuery = await db.collection("dictionary")
          .where("words", "==", words).get();

      if (perfectQuery.docs.length > 0) {
        wres.exactMatch = true;
        documents.push(...perfectQuery.docs);
      } else {
        documents = await searchAlgorithm(words);
      }

      //  If the query didn't find any word documents,
      //  then we call dictionaryGenerator() to make one
      if (documents.length === 0) {
        let document: DocumentData;
        wres = await callCloudFunction("dictionaryGenerator", words);
        //  If there is an error when creating the document, try a second time
        if (wres.errorCode !== -1) {
          wres = await callCloudFunction("dictionaryGenerator", words);
        }

        //  If the document is finally created succesfully,
        //  then we proceed to store it in the database
        if (wres.errorCode === -1) {
          document = wres.docs[0];

          const message = JSON.stringify(document);
          functions.logger.log("DOCUMENT CONTENTS:", {message});
          
          await db.collection("dictionary").doc(words).set(document)
              .catch((error) => {
                wres.error = `ERROR IN FIRESTORE: ${error}`;
                wres.errorCode = 8;
              });
          documents.push(document);
        }
      }

      //  Finally we return the response to the client
      wres.docs.push(...documents);
      res.status(200).send(wres);
    });


//  Self-made algorithm to search efficiently for word results
//  in a dictionary that match with the given word request
export async function searchAlgorithm(words: string)
: Promise<Array<DocumentData>> {
  //  First of all, we create the subcombinations of 2 words
  //  for the req text that has been sent from the client
  const combinations = makeCombinations(words);

  //  Special case for when the search is composed of only one word
  if (combinations.length === 0) {
    const query = await db.collection("dictionary")
        .where("words", "==", words).get();
    return query.docs;
  }

  //  Firestore's arrayContainsAny() method only allows querying
  //  for 10 elements each time it is called, so we have to divide
  //  the combinations array in chunks of 10 combinations each
  const groups = divideArray(combinations, 10);

  //  Then, we call as much queries as necessary to return
  //  all the documents that match with what's in the database
  let documents: Array<DocumentData> = [];
  const firstBatch: Array<Promise<QuerySnapshot<DocumentData>>> = [];
  const secondBatch: Array<Promise<QuerySnapshot<DocumentData>>> = [];

  //  First batch of queries:
  //  (first 1/3, unoptimised)
  groups.forEach(async (group: Array<string>, i: number) => {
    if (i < Math.floor(groups.length/3)) {
      const query = db.collection("dictionary")
          .where("combinations", "array-contains-any", group);
      firstBatch.push(query.get());
    }
  });

  await Promise.all(firstBatch)
      .then((snapshots) => {
        //  We pull out the documents from the query snapshots
        snapshots.forEach((snapshot) => {
          documents.push(...snapshot.docs);
        });
        //  This line of code erases any duplicate documents
        documents = [...new Set(documents)];
      });

  //  Second batch of queries:
  //  (last 2/3, optimised hopefully)
  groups.forEach(async (group: Array<string>, i: number) => {
    if (i >= Math.floor(groups.length/3) ) {
      let query = db.collection("dictionary")
          .where("combinations", "array-contains-any", group);
      //  We optimise the subsequent queries to return the least
      //  amount of duplicate data possible and in turn save more money
      if (documents.length > 0) {
        query = optimiseQuery(query, documents);
      }
      secondBatch.push(query.get());
    }
  });

  await Promise.all(secondBatch)
      .then((snapshots) => {
        snapshots.forEach((snapshot) => {
          documents.push(...snapshot.docs);
        });
        documents = [...new Set(documents)];
      });

  return documents;
}


//  Gives all possible 2-word combinations of a given phrase
export function makeCombinations(text: string) {
  const words = text.split(/\s/gm);
  const combinations: Array<string> = [];
  words.forEach((word, i) => {
    words.forEach((copy, j) => {
      if (i<j) {
        combinations.push(`${word} ${copy}`);
      }
    });
  });
  console.log(combinations.toString());
  return combinations;
}


//  Divides an array of elements into subgroups of n elements each
export function divideArray(array: Array<any>, itemsPerChunk: number) {
  const aux: Array<any> = [];
  return array.reduce((all, one, i) => {
    const chunk = Math.floor(i/itemsPerChunk);
    all[chunk] = aux.concat((all[chunk]||[]), one);
    return all;
  }, []);
}


//  This method minimises the number of duplicate
//  documents returned by subsequent queries
export function optimiseQuery(query: Query<DocumentData>,
    documents: Array<DocumentData>): Query {
  const words: Array<string> = [];
  documents.forEach((doc, i) => {
    //  Firestore imposes a limit of 10 elements maximum to
    //  be included when querying with a 'not-in' conditional
    if (i < 10) {
      words.push(doc.words);
    }
  });
  return query.where("words", "not-in", words);
}


//  Calls any of your cloud functions and returns its response
export async function callCloudFunction(name: string, message: string)
: Promise<any> {
  const wres = new WordResponse();
  const url = `https://europe-west1-candle-9cfbb.cloudfunctions.net/${name}`;
  await fetch(url, {method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({"words": message})}
  )
      .then(async (result) => {
        const cfresponse = await result.json() as WordResponse;
        const doc = cfresponse.docs[0] as DocumentData;
        wres.docs.push(doc);
      })
      .catch((error) => {
        wres.error = `ERROR CALLING CLOUD FUNCTION: ${error}`;
        wres.errorCode = 7;

        //  La ultima linea sirve para loguear informacion a GCP
        const message = JSON.stringify(wres);
        functions.logger.warn("RESPONSE CONTENTS:", {message});
      });
  return wres;
}