# Backend Express Web Hooks

Serveur Express minimal avec deux routes :

- `GET /` : vérifie que le backend fonctionne
- `POST /echo` : renvoie le corps JSON reçu
- `POST /webhook` : route webhook pour recevoir un payload JSON depuis une requête curl

## Installation

```bash
npm install
```

## Démarrage

```bash
npm start
```

## Test

```bash
curl http://localhost:3000/
```
