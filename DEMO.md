# krole — script de démonstration

Présentation guidée (~8–10 min). krole tourne sur CPU : les réponses prennent
quelques secondes, l'évaluation plusieurs minutes. **Préparez tout avant le
public.**

## 0. Préparation (avant la démo)

```bash
cp .env.example .env
docker compose up --build -d
docker exec -it rag_ollama ollama pull mistral
docker exec -it rag_ollama ollama pull bge-m3
```

Préchauffer pour éviter le démarrage à froid :

- Ouvrir http://localhost:5173 → l'API et les modèles STT/TTS se chargent.
- Vérifier l'état : `curl http://localhost:8000/health` → `{"status":"ok"}`.
- Poser **une** question d'échauffement (charge Mistral en RAM, `keep_alive`).
- Ingérer les deux documents de démo si besoin (glisser-déposer dans la barre
  latérale) : `zorblax.txt` (faits synthétiques nets) et l'exposé **Apache
  Spark** (PDF). Attendre la fin de l'indexation.
- Optionnel : lancer une évaluation à l'avance pour afficher un résultat en
  cache pendant la démo (un run complet est long).

## 1. Landing & positionnement (30 s)

- Ouvrir `/` : wordmark **krole**, tagline « le RAG souverain, 100 % local ».
- Survoler la section valeur (local & souverain, citations, graphe, voix,
  RAGAS). Cliquer **Lancer l'app** → `/app`.
- Mentionner la bascule **langue FR/EN** et **thème** en haut de la barre
  latérale (basculer une fois pour montrer que toute l'UI suit).

## 2. Contraste avec / sans RAG (2 min) — le moment clé

1. Dans la barre de saisie, **désactiver RAG** (bouton « Mistral seul »).
   Demander : **« qu'est-ce que Spark ? »**
   → Mistral répond de mémoire : fluide mais **sans sources**, et peut
   **halluciner** des détails (badge ambre « Mistral seul · sans contexte »).
2. **Réactiver RAG**. Reposer la **même** question.
   → Réponse **ancrée** dans le PDF, avec citations `[n]` (badge « RAG · sources
   citées »). Insister sur le contraste : même modèle, mais ancré et vérifiable.

## 3. Citations → source surlignée (1 min)

- Sous la réponse RAG, cliquer un badge `[1]` (ou une source listée).
- Le tiroir de droite ouvre le **PDF à la bonne page**, passage **surligné**.
- Question de contrôle factuelle (réponse exacte attendue) :
  **« À quelle température fonctionne le réacteur Zorblax ? »** → *742 °C*,
  cité depuis `zorblax.txt`.

## 4. Investigation & mode debug (1 min)

- Déplier le panneau **Investigation** sous une réponse : étapes du pipeline,
  candidats, reclassement, **latences** (en mono).
- Activer le **toggle Debug** dans la barre de saisie, reposer une question :
  l'Investigation affiche en plus le **prompt assemblé**, les **chunks scorés**
  (vector / BM25 / RRF / rerank) et les **token counts**.

## 5. Graphe de connaissances (1 min)

- Onglet **Graphe**. Si vide, cliquer **Construire le graphe** (extraction LLM,
  longue sur CPU — d'où l'intérêt de l'avoir préparé).
- Cliquer un **nœud** (ex. *Netflix*, *Spark*) → le panneau de droite liste les
  **chunks** où l'entité apparaît ; cliquer un chunk rouvre la source surlignée.
- Filtrer par document via le menu déroulant ; montrer la légende des types.

## 6. Mode vocal (1 min)

- Revenir sur **Chat**. Cliquer le **micro**, dire **« qu'est-ce que Spark ? »**,
  re-cliquer pour arrêter.
- Whisper transcrit → le texte **apparaît dans la barre** (pas d'envoi auto :
  on relit) → **Envoyer**.
- Activer le **haut-parleur** (TTS), reposer une question : la réponse est **lue
  à voix haute en français** (Piper). Montrer le bouton **stop**.
- Souligner : transcription **et** synthèse 100 % locales, hors ligne.

## 7. Évaluation RAGAS (1 min)

- Onglet **Éval**. Montrer le **dernier résultat en cache** : cartes de métriques
  (fidélité, pertinence, précision/rappel du contexte) + histogramme.
- Déplier une ligne du tableau : **réponse générée vs réponse de référence** +
  contextes récupérés.
- Insister : le **juge est Mistral en local** (bge-m3 pour les embeddings),
  **aucun appel OpenAI** — la mesure de qualité est elle aussi souveraine.
- (Si le temps le permet) cliquer **Lancer l'évaluation** pour montrer la
  progression en direct, puis revenir au cache (le run continue en arrière-plan).

## 8. Conclusion (30 s)

- Tout ce qui vient d'être montré tourne **sur cette machine**, via Docker,
  **sans aucun appel cloud** : RAG, voix, graphe, et même l'évaluation.
- Récapituler : souveraineté, citations vérifiables, observabilité (debug +
  RAGAS), UX soignée bilingue.

---

### Dépannage express

| Symptôme                         | Cause probable / action                              |
| -------------------------------- | ---------------------------------------------------- |
| 1re réponse très lente           | Mistral se charge en RAM → échauffer avant la démo.  |
| « Backend injoignable »          | `docker compose ps` ; attendre `Application startup`. |
| Réponse vide / garde-fou         | Document non indexé, ou question hors corpus.        |
| Micro inactif                    | Autoriser le micro dans le navigateur (HTTPS/localhost). |
| Éval « plusieurs minutes »       | Normal sur CPU ; s'appuyer sur le résultat en cache. |
