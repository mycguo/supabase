import { createClient } from '@supabase/supabase-js';
import { OpenAIStream, StreamingTextResponse } from 'ai';
import { codeBlock } from 'common-tags';
import OpenAI from 'openai';
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

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: authorization ? {
        authorization,
      } : {},
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
      match_threshold: 0.1,
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

  console.log('Sending request to OpenAI...');
  try {
    const completionStream = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo-0125',
      messages: completionMessages,
      max_tokens: 1024,
      temperature: 0,
      stream: true,
    });
    console.log('OpenAI request successful, creating stream...');

    const stream = OpenAIStream(completionStream);

    // Create a TransformStream to log chunks
    const loggingStream = new TransformStream({
      transform(chunk, controller) {
        console.log('Stream chunk:', new TextDecoder().decode(chunk));
        controller.enqueue(chunk);
      },
    });

    return new StreamingTextResponse(stream.pipeThrough(loggingStream), { headers: corsHeaders });
  } catch (error) {
    console.error('OpenAI error:', error);
    return new Response(
      JSON.stringify({ error: 'Error calling OpenAI: ' + (error as any).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
