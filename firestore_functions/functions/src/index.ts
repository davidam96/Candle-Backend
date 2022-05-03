import * as functions from "firebase-functions";
import * as admin from "firebase-admin";


//Boot up Candle's firebase app
const firebase = admin.initializeApp()
//Create the database object to work with firestore
const db = firebase.firestore()


export const findWords = functions.https.onRequest(async (request, response) => {
  //First of all, we create the subcombinations of 2 words
  //for the request text that has been sent from the client
  let combinations = createCombinations(request.body.words)

  //Firestore's arrayContainsAny() method only allows querying
  //for 10 elements each time it is called, so we have to divide
  //the combinations array in chunks of 10 combinations each
  let divisions = divideArray(combinations, 10)

  //Then, we call as much queries as necessary to return
  //all the documents that match with what's in the database
  let documents: Array<any> = []
  divisions.forEach(async (division: Array<string>) => {
    let query = db.collection("words").where('combinations', 'array-contains-any', division);
    documents.push(...(await query.get()).docs)
  })
  if (documents.length > 1) {
    //This line of code erases duplicate elements inside an array
    documents = [...new Set(documents)]
  }

  //Finally we return the response to the client
  response.status(200).send(documents);
})

export function createCombinations(text: string) {
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


// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
