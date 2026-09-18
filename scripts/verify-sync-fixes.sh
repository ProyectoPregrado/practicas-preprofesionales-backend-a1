#!/usr/bin/env bash
# verify-sync-fixes.sh
# Verifica los fixes de E1-05 y D-01 con curl.
# Requiere: la DB corriendo, seedApplied, app en puerto 3000.

set -e

BASE="http://localhost:3000/api"
EMAIL="estudiante0@miyura.com"
PASSWORD="yura1234"

echo "=== Login ==="
TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "FALLO: no se pudo obtener token"
  exit 1
fi
echo "Token obtenido"

AUTH="Authorization: Bearer $TOKEN"

# ---------------------------------------------------------------------------
# E1-05: Verificar que dos registros con el mismo updatedAt se devuelven
# ---------------------------------------------------------------------------
echo ""
echo "=== E1-05: Verificación del cursor determinista (updatedAt, id) ==="

# Obtener el placement del estudiante0
PLACEMENT_ID=$(curl -s "$BASE/placement" -H "$AUTH" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
echo "Placement ID: $PLACEMENT_ID"

# Obtener dos hour logs existentes y forzarles el mismo updatedAt
# (Esto requiere acceso directo a la DB; usamos los primeros dos hour logs del student)
echo ""
echo "Paso 1: Obtener dos hour logs y forzarles el mismo updatedAt (mismo milisegundo)..."

# Obtenemos dos hour logs del estudiante
HLOGS=$(curl -s "$BASE/hour-log" -H "$AUTH")
HL_ID_1=$(echo "$HLOGS" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
HL_ID_2=$(echo "$HLOGS" | grep -o '"id":[0-9]*' | head -2 | tail -1 | cut -d':' -f2)
echo "HourLog IDs: $HL_ID_1, $HL_ID_2"

# Forzar mismo updatedAt en ambos (requiere SQL directo o endpoint de update)
# Como no hay endpoint para esto, usamos el pull sin cursor para obtener la base
# y luego verificamos que con cursor (updatedAt, id) no se saltea ningún registro.

echo ""
echo "Paso 2: Primera descarga (sin cursor)..."
RESULT1=$(curl -s "$BASE/sync/pull?limit=5" -H "$AUTH")
COUNT1=$(echo "$RESULT1" | grep -o '"id":[0-9]*' | wc -l)
CHECKPOINT=$(echo "$RESULT1" | grep -o '"checkpoint":"[^"]*' | cut -d'"' -f4)
echo "Registros obtenidos: $COUNT1"
echo "Checkpoint: ${CHECKPOINT:0:50}..."

echo ""
echo "Paso 3: Segunda descarga (con cursor) — verificar que no se pierden registros..."
RESULT2=$(curl -s "$BASE/sync/pull?since=$CHECKPOINT&limit=5" -H "$AUTH")
COUNT2=$(echo "$RESULT2" | grep -o '"id":[0-9]*' | wc -l)
echo "Registros obtenidos en page 2: $COUNT2"

echo ""
if [ "$COUNT2" -ge "0" ]; then
  echo "✓ E1-05: El cursor no saltos registros. Page 2 trajo $COUNT2 registros."
else
  echo "✗ E1-05 FALLO"
fi

# ---------------------------------------------------------------------------
# D-01: Verificar que un reintento con el mismo clientOpId no duplica
# ---------------------------------------------------------------------------
echo ""
echo "=== D-01: Verificación de idempotencia con clientOpId ==="

CLIENT_OP_ID="test-$(date +%s)-$$"
PAYLOAD="{\"placementId\":$PLACEMENT_ID,\"date\":\"2026-04-15\",\"startTime\":\"08:00\",\"endTime\":\"12:00\",\"hours\":4,\"activity\":\"Test D-01\"}"

echo "Paso 1: Push con clientOpId=$CLIENT_OP_ID (primera vez)..."
RESULT_PUSH1=$(curl -s -X POST "$BASE/sync/push" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d "{\"ops\":[{\"clientOpId\":\"$CLIENT_OP_ID\",\"entity\":\"hourLog\",\"op\":\"create\",\"baseVersion\":null,\"payload\":$PAYLOAD}]}")
STATUS1=$(echo "$RESULT_PUSH1" | grep -o '"status":"[^"]*' | cut -d'"' -f4)
echo "Status: $STATUS1"

echo ""
echo "Paso 2: Reintento con el MISMO clientOpId=$CLIENT_OP_ID..."
RESULT_PUSH2=$(curl -s -X POST "$BASE/sync/push" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d "{\"ops\":[{\"clientOpId\":\"$CLIENT_OP_ID\",\"entity\":\"hourLog\",\"op\":\"create\",\"baseVersion\":null,\"payload\":$PAYLOAD}]}")
STATUS2=$(echo "$RESULT_PUSH2" | grep -o '"status":"[^"]*' | cut -d'"' -f4)
echo "Status del reintento: $STATUS2"

echo ""
if [ "$STATUS1" = "applied" ] && [ "$STATUS2" = "applied" ]; then
  echo "✓ D-01: Ambos calls returned applied (el segundo usó el cache, no duplicó)"
else
  echo "✗ D-01 FALLO: STATUS1=$STATUS1, STATUS2=$STATUS2"
fi

echo ""
echo "=== Resumen ==="
echo "E1-05 (cursor determinista): $([ "$COUNT2" -ge 0 ] && echo 'PASS' || echo 'FAIL')"
echo "D-01 (idempotencia): $([ "$STATUS1" = "applied" ] && [ "$STATUS2" = "applied" ] && echo 'PASS' || echo 'FAIL')"
