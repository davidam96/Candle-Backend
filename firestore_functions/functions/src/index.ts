import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import Query = FirebaseFirestore.Query
import QuerySnapshot = FirebaseFirestore.QuerySnapshot
import DocumentData = FirebaseFirestore.DocumentData


//Boot up Candle's firebase app and create
//the database object to work with firestore
const firebase = admin.initializeApp()
const db = firebase.firestore()


export const findWords = functions.https.onRequest(async (request, response) => {

  //Parsing the request into an object
  let words = request.body.words || JSON.parse(request.body.data).words || "";

  //First of all, we create the subcombinations of 2 words
  //for the request text that has been sent from the client
  let combinations = makeCombinations(words)

  //Firestore's arrayContainsAny() method only allows querying
  //for 10 elements each time it is called, so we have to divide
  //the combinations array in chunks of 10 combinations each
  let groups = divideArray(combinations, 10)

  //Then, we call as much queries as necessary to return
  //all the documents that match with what's in the database
  let documents: Array<DocumentData> = []
  let firstBatch: Array<Promise<QuerySnapshot<DocumentData>>> = []
  let secondBatch: Array<Promise<QuerySnapshot<DocumentData>>> = []

  //First batch of queries:
  //(first 1/3, unoptimised)
  groups.forEach(async(group: Array<string>, i: number) => {
    if (i < Math.floor(groups.length/3)) {
      let query = db.collection("words").where('combinations', 'array-contains-any', group);
      firstBatch.push(query.get())
    }
  })

  await Promise.all(firstBatch)
  .then(async(snapshots) => {
    //We pull out the documents from the query snapshots
    snapshots.forEach(snapshot => {
      documents.push(snapshot.docs)
    })
    //This line of code erases any duplicate documents
    documents = [...new Set(documents)]
  })

  //Second batch of queries:
  //(last 2/3, optimised hopefully)
  groups.forEach(async(group: Array<string>, i: number) => {
    if (i >= Math.floor(groups.length/3) ) {
      let query = db.collection("words").where('combinations', 'array-contains-any', group);
      //We optimise the subsequent queries to return the least
      //amount of duplicate data possible and in turn save more money
      if (documents.length > 0) {
        query = optimiseQuery(query, documents)
      }
      secondBatch.push(query.get())
    }
  })

  await Promise.all(secondBatch)
  .then(snapshots => {
    snapshots.forEach(snapshot => {
      documents.push(snapshot.docs)
    })
    documents = [...new Set(documents)]
  })

  // ---------- TRANSACTION (PUT IT IN ITS OWN SEPARATE FUNCTION) ----------

  //If the query didn't find any word documents,
  //then we call dictionaryGenerator() to make one
  if (documents.length === 0) {
    let document: DocumentData
    document = await callCloudFunction("dictionaryGenerator", words)
    if (!document.callError && document.errorCode === -1) {
        document = await callCloudFunction("dictionaryGenerator", words)
    }
    else if (!document.callError && document.errorCode !== -1) {
      //After having created a document,
      //we store it in the database
      db.collection("dictionary").add(document)
      .then(docRef => {
        console.log("Document written with ID: ", docRef.id);
      })
      .catch((error) => {
        console.error("Error adding document: ", error);
      })
    }
    documents.push(document)
  }

  // ---------- TRANSACTION (PUT IT IN ITS OWN SEPARATE FUNCTION) ----------

  //Finally we return the response to the client
  response.status(200).send(documents);
})

export async function retry(document: any): Promise<any> {

}


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

//This method minimises the number of duplicate documents returned by subsequent queries
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

export async function callCloudFunction(name: string, data: string): Promise<any> {
  let contents = {}
  let url = `https://europe-west1-candle-9cfbb.cloudfunctions.net/${name}`
  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })
  .then(async(response) => {
    contents = JSON.parse(await response.json())
  })
  .catch((error) => {
    contents = JSON.parse(`{"callError": ${error}}`)
    console.error("ERROR CALLING CLOUD FUNCTION: ", error)
  })
  return contents
}


// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
