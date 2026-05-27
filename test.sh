PAYLOAD='{"event":"payment_succeeded","amount":4999,"currency":"eur","id":"pay_test_123"}'
SECRET='whsec_student_test_secret_123'
TIMESTAMP=$(date +%s)

SIGNATURE=$(printf "%s.%s" "$TIMESTAMP" "$PAYLOAD" \
  | openssl dgst -sha256 -hmac "$SECRET" -hex \
  | sed 's/^.* //')

echo "DEBUG - Timestamp: $TIMESTAMP"
echo "DEBUG - Signature: $SIGNATURE"
echo "DEBUG - Header: t=$TIMESTAMP,v1=$SIGNATURE"

curl -X POST http://localhost:3001/webhook \
  -v \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: t=$TIMESTAMP,v1=$SIGNATURE" \
  -d "$PAYLOAD"
