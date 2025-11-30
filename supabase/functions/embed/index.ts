// Minimal embed function without any external dependencies
// @ts-nocheck
const model = new Supabase.ai.Session('gte-small');

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

Deno.serve(async (req) => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(
      JSON.stringify({ error: 'Missing environment variables' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { ids, table, contentColumn, embeddingColumn } = await req.json();

  // Fetch rows using REST API
  const fetchUrl = `${SUPABASE_URL}/rest/v1/${table}?id=in.(${ids.join(',')})&${embeddingColumn}=is.null`;
  const fetchResponse = await fetch(fetchUrl, {
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
  });

  if (!fetchResponse.ok) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch rows' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const rows = await fetchResponse.json();

  for (const row of rows) {
    const content = row[contentColumn];
    if (!content) {
      console.error(`No content in column '${contentColumn}'`);
      continue;
    }

    const output = await model.run(content, {
      mean_pool: true,
      normalize: true,
    });

    const embedding = JSON.stringify(Array.from(output));

    // Update using REST API
    const updateUrl = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${row.id}`;
    const updateResponse = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ [embeddingColumn]: embedding }),
    });

    if (!updateResponse.ok) {
      console.error(`Failed to update ${table} id ${row.id}`);
    } else {
      console.log(`Generated embedding for ${table} id ${row.id}`);
    }
  }

  return new Response(null, {
    status: 204,
    headers: { 'Content-Type': 'application/json' },
  });
});
