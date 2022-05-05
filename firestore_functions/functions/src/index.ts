import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import Query = FirebaseFirestore.Query
import DocumentData = FirebaseFirestore.DocumentData

//Boot up Candle's firebase app
const firebase = admin.initializeApp()
//Create the database object to work with firestore
const db = firebase.firestore()


export const findWords = functions.https.onRequest(async (request, response) => {
  //First of all, we create the subcombinations of 2 words
  //for the request text that has been sent from the client
  let combinations = makeCombinations(request.body.words)

  //Firestore's arrayContainsAny() method only allows querying
  //for 10 elements each time it is called, so we have to divide
  //the combinations array in chunks of 10 combinations each
  let groups = divideArray(combinations, 10)

  //Then, we call as much queries as necessary to return
  //all the documents that match with what's in the database
  let documents: Array<DocumentData> = []
  let query: Query
  groups.forEach(async (group: Array<string>) => {
    query = db.collection("words").where('combinations', 'array-contains-any', group);
    if (documents.length > 0) {
      //This method minimises the number of duplicate
      //documents returned by subsequent queries
      query = optimiseQuery(query, documents)
    }
    documents.push(...(await query.get()).docs)
  })
  if (documents.length > 1) {
    //This line of code erases any duplicate documents
    documents = [...new Set(documents)]
  }

  //Finally we return the response to the client
  response.status(200).send(documents);
})


export function makeCombinations(text: string) {
  let words = text.split(/\s/gm);
  let combinations: Array<string> = [];
  words.forEach((word, i) => {
    words.forEach((copy, j) => {
      if (i<j)
        combinations.push(`${word} ${copy}`);
    });
  });
  console.log(combinations.toString());
  return combinations;
}


export function divideArray(array: Array<any>, itemsPerChunk: number) {
  const aux: Array<any> = []
  return array.reduce((all, one, i) => {
    const chunk = Math.floor(i/itemsPerChunk)
    all[chunk] = aux.concat((all[chunk]||[]), one)
    return all
  }, [])
}


export function optimiseQuery(query: Query<DocumentData>, documents: Array<DocumentData>): Query {
  let words: Array<string> = []
  documents.forEach((doc, i) => {
    //Firestore imposes a limit of 10 elements maximum to
    //be included when querying with a 'not-in' conditional
    if (i < 10)
      words.push(doc.words)
  })
  return query.where('words', 'not-in', words)
}


// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
