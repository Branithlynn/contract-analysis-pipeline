import type { FastifyPluginCallback } from "fastify";
import type { ModelsResponse } from "@nexus/shared";
import type { ModelCatalog } from "../services/models.js";

export interface ModelRouteDeps {
  models: ModelCatalog;
}

export const modelRoutes: FastifyPluginCallback<ModelRouteDeps> = (app, { models }, done) => {
  // What the upload form offers. The same catalog checks a selection when it comes back.
  app.get("/models", (): Promise<ModelsResponse> => models.list());

  done();
};
