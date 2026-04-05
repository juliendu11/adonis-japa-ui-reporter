# Architecture — japa-ui-reporter

## Vue d'ensemble des composants

```mermaid
graph TB
    subgraph TestRunner["Test Runner (Japa)"]
        TR[Tests]
        UR[UIReporter<br/>src/ui_reporter.ts]
        TR -->|lifecycle hooks| UR
    end

    subgraph Server["Serveur Node.js (src/ui/server.ts)"]
        TCP[TCP Server<br/>port 9999]
        HTTP[HTTP Server<br/>port 3000]
        WS[WebSocket Server<br/>port 3000]
        STATE[runState<br/>résultats accumulés]

        TCP --> STATE
        STATE --> WS
        TCP -.->|late-join replay| WS
    end

    subgraph Client["Navigateur (src/ui/public/index.html)"]
        UI[Dashboard UI]
        WSC[WebSocket Client]
        UI --- WSC
    end

    subgraph Output["Sortie fichier"]
        HTML[test_results/report.html<br/>rapport statique]
    end

    UR -->|TCP JSON + newline<br/>port 9999| TCP
    HTTP -->|sert index.html| UI
    WS -->|events JSON| WSC
    STATE -->|génération fin de run| HTML

    Browser[Navigateur] -->|HTTP GET /| HTTP
    Browser -->|WS upgrade| WS
```

---

## Flux de communication détaillé

```mermaid
sequenceDiagram
    participant TR as Test Runner (Japa)
    participant UR as UIReporter
    participant TCP as TCP Server :9999
    participant STATE as runState
    participant WS as WebSocket Server
    participant UI as Dashboard (Browser)

    Note over TR,UI: Démarrage
    TR->>UR: start()
    UR->>TCP: connexion TCP
    UR-->>TCP: "CLEAR\n"
    TCP->>STATE: reset runState
    TCP->>WS: broadcast { type: "run:start" }
    WS->>UI: { type: "run:start" }
    Note over UI: clearResults(), reset filtres

    Note over TR,UI: Exécution des tests
    loop Pour chaque test
        TR->>UR: onTestEnd(test)
        UR-->>TCP: JSON test + "\n"
        TCP->>STATE: push result dans runState.results
        TCP->>WS: broadcast { type: "test:result", data: {...} }
        WS->>UI: { type: "test:result", data: {...} }
        Note over UI: addTestResult(), rendu pass/fail
    end

    Note over TR,UI: Fin de run
    TR->>UR: end()
    UR-->>TCP: "END\n"
    TCP->>STATE: tri des résultats (échecs en premier)
    TCP->>WS: broadcast { type: "run:sort" }
    WS->>UI: { type: "run:sort" }
    Note over UI: sortResults()
    TCP->>WS: broadcast { type: "run:end" }
    WS->>UI: { type: "run:end" }
    Note over UI: affiche stats finales (pass/fail)
    TCP-->>TCP: génère test_results/report.html

    Note over TR,UI: Connexion tardive (late-join)
    UI->>WS: nouvelle connexion WebSocket
    WS->>STATE: lit runState accumulé
    STATE-->>WS: replay de tous les événements passés
    WS->>UI: run:start + tous les test:result + (run:end si terminé)
```

---

## Messages TCP (Reporter → Serveur)

| Message | Format | Quand | Effet |
|---------|--------|-------|-------|
| `CLEAR` | Texte brut | Début du run (`onTestStart`) | Reset du dashboard |
| Test result | JSON + `\n` | Fin de chaque test (`onTestEnd`) | Ajout du résultat |
| `END` | Texte brut | Fin du run (`end`) | Tri + rapport HTML |

### Structure d'un résultat de test (TCP → WS)
```json
{
  "title": "nom du test",
  "group": { "title": "nom du groupe" },
  "hasError": false,
  "errors": [],
  "duration": 5.234,
  "file": { "name": "chemin/du/fichier" }
}
```

---

## Events WebSocket (Serveur → Dashboard)

| Event | Payload | Effet dans l'UI |
|-------|---------|-----------------|
| `run:start` | `{ type: "run:start" }` | Vide les résultats, affiche "Running..." |
| `test:result` | `{ type: "test:result", data: {...} }` | Ajoute un test (icône ✓/✗) |
| `run:sort` | `{ type: "run:sort" }` | Trie les groupes et tests (échecs en premier) |
| `run:end` | `{ type: "run:end" }` | Affiche les stats finales, scroll en haut |

---

## Configuration

```ts
UIReporter.ui({
    ui:       { port: 3000 },   // HTTP + WebSocket (défaut: 3000)
    reporter: { port: 9999 },   // TCP (défaut: 9999)
    killPortsInUse: true,       // Tue les processus sur les ports (défaut: true)
    livePreview: true,          // Ouvre le navigateur auto (défaut: true)
})
```

---

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| `src/index.ts` | Point d'entrée, exports |
| `src/handler.ts` | Fonction `ui()` qui instancie UIReporter |
| `src/types.ts` | Interfaces TypeScript |
| `src/ui_reporter.ts` | Classe UIReporter, hooks Japa, client TCP |
| `src/ui/server.ts` | Serveurs TCP + HTTP/WebSocket, routage des messages |
| `src/ui/public/index.html` | Dashboard (HTML + CSS + JS vanilla) |
