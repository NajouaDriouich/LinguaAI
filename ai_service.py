import os
from pathlib import Path
from dotenv import load_dotenv
from mistralai.client import Mistral

# 1. Charger le fichier ai.env
base_dir = Path(__file__).resolve().parent
env_path = base_dir / "ai.env"
load_dotenv(env_path)

# 2. Recuperer la cle API
api_key = os.getenv("MISTRAL_API_KEY")

# 3. Creer le client Mistral
client = None

if api_key:
    try:
        client = Mistral(api_key=api_key)
        print("Connexion à Mistral AI réussie !")
    except Exception as e:
        print("Erreur de connexion :", e)
else:
    print("Erreur : API Key introuvable !")


# 4. Instructions de LanguageBot
SYSTEM_INSTRUCTION = """
You are LanguageBot, a language learning assistant.
You help users learn French and English.

Your mission:
1. Analyze the user's sentence.
2. Detect grammar, spelling and vocabulary mistakes.
3. Give the corrected sentence.
4. Identify and explain each mistake simply.
5. Give an additional correct example.

For French:
- Explain French grammar rules accurately.
- Correct spelling, conjugation, gender and sentence structure.

For English:
- After "doesn't" or "don't", always use the base form of the verb.
- With he, she and it in affirmative present simple sentences,
  add -s or -es to the main verb.
- Explain each correction accurately.
- Never give contradictory explanations.

IMPORTANT:
- Respond in the same language as the user's message:
  French or English.
- Do not invent mistakes.
- If the sentence is already correct, say so.
- Use clear and simple explanations.
"""


# 5. Fonction principale utilisee par Flask
def get_reply(messages):

    if client is None:
        return "Connexion à Mistral AI indisponible."

    if not isinstance(messages, list) or len(messages) == 0:
        return "Aucun message reçu."

    try:
        conversation_messages = [
            {
                "role": "system",
                "content": SYSTEM_INSTRUCTION
            }
        ] + messages

        response = client.chat.complete(
            model="ministral-8b-latest",
            max_tokens=500,
            messages=conversation_messages
        )

        answer = response.choices[0].message.content

        return str(answer)

    except Exception as e:
        print("Erreur Mistral AI :", e)
        return "Une erreur est survenue lors de la génération de la réponse."
