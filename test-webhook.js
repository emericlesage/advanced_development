import crypto from 'crypto';

const PAYLOAD = JSON.stringify({
    event: "payment_succeeded",
    amount: 4999,
    currency: "eur",
    id: "pay_test_123"
});
const SECRET = 'whsec_student_test_secret_123';
const TIMESTAMP = Math.floor(Date.now() / 1000).toString();

const payloadToSign = `${TIMESTAMP}.${PAYLOAD}`;
const SIGNATURE = crypto
    .createHmac('sha256', SECRET)
    .update(payloadToSign)
    .digest('hex');

console.log('--- Données générées ---');
console.log('Timestamp :', TIMESTAMP);
console.log('Signature :', SIGNATURE);
console.log('------------------------\n');

fetch('http://localhost:3000/webhook', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': `t=${TIMESTAMP},v1=${SIGNATURE}`
    },
    body: PAYLOAD
})
.then(res => res.json().then(data => ({ status: res.status, body: data })))
.then(res => {
    console.log(`Réponse du serveur (Statut ${res.status}):`);
    console.log(res.body);
})
.catch(err => console.error('Erreur lors de la requête :', err));
