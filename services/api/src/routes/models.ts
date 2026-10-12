import type { FastifyPluginCallback } from "fastify";
import { z } from "zod";
import type { ModelsResponse } from "@nexus/shared";
import type { ModelCatalog } from "../services/models.js";

export interface ModelRouteDeps {
  models: ModelCatalog;
}

const ModelsQuery = z.object({ refresh: z.enum(["1", "true"]).optional() });

export const modelRoutes: FastifyPluginCallback<ModelRouteDeps> = (app, { models }, done) => {
  // What the upload form offers. The same catalog checks a selection when it comes back.
  app.get("/models", (request): Promise<ModelsResponse> => {
    const { refresh } = ModelsQuery.parse(request.query);
    return models.list({ refresh: refresh !== undefined });
  });

  done();
};
