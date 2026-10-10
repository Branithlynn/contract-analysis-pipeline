import { fastify } from "fastify";

// The first fastify() in a process lazily loads ~250 modules (three ajv copies, ajv-formats,
// fast-json-stringify) and compiles their meta-schemas: about 1s on a quiet machine, 5s+ when the
// disk is busy. Each test file runs in a fresh worker, so without this the first test that builds a
// server pays it inside its own timeout and fails now and then. Setup files aren't charged to any test.
await fastify().close();
