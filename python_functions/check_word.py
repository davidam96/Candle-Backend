import openai

openai.api_key = "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"

def isValidWord():
  answer = openai.Answer.create(
    model="curie",
    question="Is 'melody' an english word?",
    examples_context="English words: dog, cat, phone, ...",
    examples=[["Is 'dog' an english word?", "Yes"],
              ["Is 'asdafsaf' an english word?", "No"]],
    documents=[],
    max_tokens=2
  )
  return answer

answer = isValidWord()
print(answer)