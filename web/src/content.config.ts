import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    keywords: z.array(z.string()).default([]),
    dataset: z.enum(["tares", "classifications", "finma", "all"]).optional(),
    /** Optional 1-3 sentence summary rendered as a TL;DR box at the top of the article. */
    tldr: z.string().optional(),
  }),
});

export const collections = { blog };
