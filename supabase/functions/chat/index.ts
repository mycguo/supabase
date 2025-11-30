import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.21.0';
import { OpenAIStream, StreamingTextResponse } from 'https://esm.sh/ai@2.2.13';
import { codeBlock } from 'https://esm.sh/common-tags@1.8.2';
import OpenAI from 'https://esm.sh/openai@4.10.0';
import { Database } from '../_lib/database.ts';

// These are automatically injected
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(
      JSON.stringify({
        error: 'Missing environment variables.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiApiKey) {
    return new Response(
      JSON.stringify({
        error: 'Missing OPENAI_API_KEY environment variable.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const openai = new OpenAI({
    apiKey: openaiApiKey,
  });

  const authorization = req.headers.get('Authorization');

  if (!authorization) {
    return new Response(
      JSON.stringify({ error: `No authorization header passed` }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        authorization,
      },
    },
    auth: {
      persistSession: false,
    },
  });

  const { messages, embedding } = await req.json();

  // Parse embedding if it's a string (it comes as JSON string from frontend)
  const embeddingArray = typeof embedding === 'string'
    ? JSON.parse(embedding)
    : embedding;

  console.log('Embedding length:', embeddingArray?.length);
  console.log('Messages count:', messages?.length);

  // Lower threshold to get more relevant results (0.5 is more permissive than 0.8)
  const { data: documents, error: matchError } = await supabase
    .rpc('match_document_sections', {
      embedding: embeddingArray,
      match_threshold: 0.5,
    })
    .select('content')
    .limit(5);

  if (matchError) {
    console.error('Match error:', matchError);

    return new Response(
      JSON.stringify({
        error: 'There was an error reading your documents, please try again.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  console.log(`Found ${documents?.length || 0} matching document sections`);

  const injectedDocs =
    documents && documents.length > 0
      ? documents.map(({ content }) => content).join('\n\n')
      : null;

  // Build messages with proper system message
  const completionMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  // Add system message with context
  if (injectedDocs) {
    completionMessages.push({
      role: 'system',
      content: codeBlock`
        You are a helpful AI assistant that answers questions based on the provided documents.
        Use the information from the documents below to answer questions accurately and helpfully.
        If the documents contain relevant information, provide a clear and concise answer.
        If the documents don't contain enough information to fully answer the question, say what you can based on the documents and indicate if more information might be needed.
        Keep your responses conversational and helpful.
        
        Documents:
        ${injectedDocs}
      `,
    });
  } else {
    completionMessages.push({
      role: 'system',
      content: 'You are a helpful AI assistant. However, no documents were found in the database. Please let the user know that they need to upload documents first to use this chat feature.',
    });
  }

  // Add conversation history
  completionMessages.push(...messages);

  const completionStream = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo-0125',
    messages: completionMessages,
    max_tokens: 1024,
    temperature: 0,
    stream: true,
  });

  const stream = OpenAIStream(completionStream);
  return new StreamingTextResponse(stream, { headers: corsHeaders });
});
