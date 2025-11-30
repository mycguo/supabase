#!/bin/bash

# Get Supabase credentials
SUPABASE_URL=$(supabase status | grep "API URL:" | awk '{print $3}')
ANON_KEY=$(supabase status | grep "Publishable key:" | awk '{print $3}')

echo "Processing documents..."
echo "Supabase URL: $SUPABASE_URL"

# Get document IDs
DOCUMENT_IDS=$(psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -t -c "SELECT id FROM documents ORDER BY created_at;")

for doc_id in $DOCUMENT_IDS; do
    echo "Processing document ID: $doc_id"
    
    # Call the process function
    curl -i "$SUPABASE_URL/functions/v1/process" \
      -H "Authorization: Bearer $ANON_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"document_id\": $doc_id}"
    
    echo ""
    echo "---"
done

echo "Done! Waiting a few seconds for embedding generation..."
sleep 5

# Check results
echo ""
echo "Document sections created:"
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "SELECT COUNT(*) as section_count FROM document_sections;"

echo ""
echo "Document sections with embeddings:"
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "SELECT COUNT(*) as sections_with_embeddings FROM document_sections WHERE embedding IS NOT NULL;"
