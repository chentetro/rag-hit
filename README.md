# HIT RAG Assistant

A prototype of the HIT RAG Assistant, a Hebrew academic AI assistant designed for HIT students.

The system is built with Next.js, TypeScript, Supabase, Google AI, Vercel AI SDK, LangChain, Tailwind CSS, and shadcn/Base UI. It crawls and indexes content from the HIT website, chunks the collected data, generates vector embeddings, and stores them in Supabase for semantic retrieval.

Student questions are answered only from verified retrieved sources. The assistant includes a streaming chat interface, source citations, scheduled recrawling with GitHub Actions, and guarded prompting to reduce unsupported answers and hallucinations.

## Prototype Status

This project is a prototype and is still under active development.

Because direct access to HIT internal systems is restricted, the system currently utilizes GitHub Authentication for user identification instead of the college's institutional login system. Additional user-scoped and organization-specific integrations are simulated with mocks that mirror expected production behavior.

## Production Roadmap

Future development will include full integration with the college's institutional identity provider (SSO), as well as adding role-based tools and workflows for different user types, ensuring each user role can access capabilities tailored to its specific needs.

## Live Demo

https://rag-hit.vercel.app/
