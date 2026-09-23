/**
 * A real Project Brain analysis of github.com/shadcn-ui/taxonomy, captured 2026-09-22
 * by running the live analyzer. Shown on the landing page so visitors see actual output.
 * Regenerate rather than edit by hand.
 */
import type { ImpactResult } from '@agentic/project-brain';

export const SAMPLE = {
  "meta": {
    "owner": "shadcn-ui",
    "repo": "taxonomy",
    "ref": "main",
    "stars": 19290
  },
  "fileCount": 188,
  "readCount": 168,
  "stack": [
    {
      "value": "Next.js",
      "confidence": "detected",
      "evidence": [
        "package.json → next",
        "next.config.mjs"
      ]
    },
    {
      "value": "Prisma",
      "confidence": "detected",
      "evidence": [
        "package.json → prisma",
        "package.json → @prisma/client"
      ]
    },
    {
      "value": "pnpm",
      "confidence": "detected",
      "evidence": [
        "pnpm-lock.yaml"
      ]
    }
  ],
  "language": {
    "name": "TypeScript",
    "files": 125,
    "bytes": 225555,
    "share": 0.945330868947481
  },
  "roles": {
    "api": 7,
    "component": 95,
    "model": 3,
    "service": 14,
    "test": 0,
    "example": 0,
    "config": 12,
    "doc": 17,
    "style": 4,
    "other": 36
  },
  "explorer": [
    "app/api/auth/[...nextauth]/_route.ts",
    "app/api/og/route.tsx",
    "app/api/posts/[postId]/route.ts",
    "app/api/posts/route.ts",
    "components/analytics.tsx",
    "components/billing-form.tsx",
    "components/callout.tsx",
    "components/card-skeleton.tsx",
    "lib/auth.ts",
    "lib/db.ts",
    "lib/exceptions.ts",
    "lib/session.ts",
    "prisma/migrations/20221021182747_init/migration.sql"
  ],
  "impact": {
    "query": "Replace Prisma with Drizzle",
    "terms": [
      "Prisma",
      "Drizzle"
    ],
    "direct": [
      "README.md",
      "app/(editor)/editor/[postId]/page.tsx",
      "app/(marketing)/page.tsx",
      "components/editor.tsx",
      "components/post-item.tsx",
      "components/post-operations.tsx",
      "components/user-avatar.tsx",
      "components/user-name-form.tsx",
      "config/docs.ts",
      "content/docs/documentation/code-blocks.mdx",
      "lib/auth.ts",
      "lib/db.ts",
      "next.config.mjs",
      "package.json",
      "prisma/migrations/20221021182747_init/migration.sql",
      "prisma/migrations/20221118173244_add_stripe_columns/migration.sql",
      "prisma/migrations/migration_lock.toml",
      "prisma/schema.prisma",
      "types/index.d.ts"
    ],
    "dependents": [
      {
        "path": "app/(dashboard)/dashboard/billing/page.tsx",
        "depth": 1
      },
      {
        "path": "app/(dashboard)/dashboard/loading.tsx",
        "depth": 1
      },
      {
        "path": "app/(dashboard)/dashboard/page.tsx",
        "depth": 1
      },
      {
        "path": "app/(dashboard)/dashboard/settings/page.tsx",
        "depth": 1
      },
      {
        "path": "app/(docs)/docs/layout.tsx",
        "depth": 1
      },
      {
        "path": "app/(docs)/layout.tsx",
        "depth": 1
      },
      {
        "path": "app/api/auth/[...nextauth]/_route.ts",
        "depth": 1
      },
      {
        "path": "app/api/posts/[postId]/route.ts",
        "depth": 1
      },
      {
        "path": "app/api/posts/route.ts",
        "depth": 1
      },
      {
        "path": "app/api/users/[userId]/route.ts",
        "depth": 1
      },
      {
        "path": "app/api/users/stripe/route.ts",
        "depth": 1
      },
      {
        "path": "app/api/webhooks/stripe/route.ts",
        "depth": 1
      },
      {
        "path": "components/pager.tsx",
        "depth": 1
      },
      {
        "path": "components/user-account-nav.tsx",
        "depth": 1
      },
      {
        "path": "lib/session.ts",
        "depth": 1
      },
      {
        "path": "lib/subscription.ts",
        "depth": 1
      },
      {
        "path": "pages/api/auth/[...nextauth].ts",
        "depth": 1
      },
      {
        "path": "app/(dashboard)/dashboard/layout.tsx",
        "depth": 2
      },
      {
        "path": "app/(docs)/docs/[[...slug]]/page.tsx",
        "depth": 2
      }
    ],
    "groups": [
      {
        "role": "api",
        "label": "API routes",
        "files": [
          "app/api/auth/[...nextauth]/_route.ts",
          "app/api/posts/[postId]/route.ts",
          "app/api/posts/route.ts",
          "app/api/users/[userId]/route.ts",
          "app/api/users/stripe/route.ts",
          "app/api/webhooks/stripe/route.ts",
          "pages/api/auth/[...nextauth].ts"
        ]
      },
      {
        "role": "model",
        "label": "Models & schemas",
        "files": [
          "prisma/migrations/20221021182747_init/migration.sql",
          "prisma/migrations/20221118173244_add_stripe_columns/migration.sql",
          "prisma/schema.prisma"
        ]
      },
      {
        "role": "service",
        "label": "Services & logic",
        "files": [
          "lib/auth.ts",
          "lib/db.ts",
          "lib/session.ts",
          "lib/subscription.ts"
        ]
      },
      {
        "role": "component",
        "label": "Components",
        "files": [
          "app/(dashboard)/dashboard/billing/page.tsx",
          "app/(dashboard)/dashboard/layout.tsx",
          "app/(dashboard)/dashboard/loading.tsx",
          "app/(dashboard)/dashboard/page.tsx",
          "app/(dashboard)/dashboard/settings/page.tsx",
          "app/(docs)/docs/[[...slug]]/page.tsx",
          "app/(docs)/docs/layout.tsx",
          "app/(docs)/layout.tsx",
          "app/(editor)/editor/[postId]/page.tsx",
          "app/(marketing)/page.tsx",
          "components/editor.tsx",
          "components/pager.tsx",
          "components/post-item.tsx",
          "components/post-operations.tsx",
          "components/user-account-nav.tsx",
          "components/user-avatar.tsx",
          "components/user-name-form.tsx"
        ]
      },
      {
        "role": "other",
        "label": "Other code",
        "files": [
          "config/docs.ts",
          "next.config.mjs",
          "types/index.d.ts"
        ]
      },
      {
        "role": "config",
        "label": "Configuration",
        "files": [
          "package.json",
          "prisma/migrations/migration_lock.toml"
        ]
      },
      {
        "role": "doc",
        "label": "Documentation",
        "files": [
          "README.md",
          "content/docs/documentation/code-blocks.mdx"
        ]
      }
    ],
    "externalPackages": [
      {
        "name": "@prisma/client",
        "files": 8
      },
      {
        "name": "prisma",
        "files": 0
      }
    ],
    "areas": [
      {
        "name": "components",
        "files": 7
      },
      {
        "name": "app/api",
        "files": 6
      },
      {
        "name": "app/(dashboard)",
        "files": 5
      },
      {
        "name": "lib",
        "files": 4
      },
      {
        "name": "prisma/migrations",
        "files": 3
      },
      {
        "name": "(root)",
        "files": 3
      }
    ],
    "total": 38,
    "risk": "high",
    "riskReason": "It reaches both the data layer and the API, so behaviour can break in several places at once.",
    "confidence": {
      "direct": "detected",
      "dependents": "inferred",
      "total": "estimated"
    }
  },
  "capturedAt": "2026-09-22"
} as const satisfies Record<string, unknown>;

export const SAMPLE_IMPACT = SAMPLE.impact as unknown as ImpactResult;
