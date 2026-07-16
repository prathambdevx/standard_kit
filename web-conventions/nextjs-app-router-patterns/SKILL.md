---
name: nextjs-app-router-patterns
description: Master Next.js 14+ App Router with Server Components, streaming, parallel routes, and advanced data fetching. Use when building Next.js applications, implementing SSR/SSG, or optimizing React Server Components.
user-invocable: false
---
# Next.js App Router Patterns

Comprehensive patterns for Next.js 14+ App Router architecture, Server Components, and modern full-stack React development.

## Usage

Invoke this skill when building new Next.js applications with App Router, migrating from Pages Router, implementing Server Components, or optimizing data fetching and caching strategies.

## Core Concepts

### Rendering Modes

| Mode                  | Where        | When to Use                               |
| --------------------- | ------------ | ----------------------------------------- |
| **Server Components** | Server only  | Data fetching, heavy computation, secrets |
| **Client Components** | Browser      | Interactivity, hooks, browser APIs        |
| **Static**            | Build time   | Content that rarely changes               |
| **Dynamic**           | Request time | Personalized or real-time data            |
| **Streaming**         | Progressive  | Large pages, slow data sources            |

### File Conventions

```
app/
├── layout.tsx       # Shared UI wrapper
├── page.tsx         # Route UI
├── loading.tsx      # Loading UI (Suspense)
├── error.tsx        # Error boundary
├── not-found.tsx    # 404 UI
├── route.ts         # API endpoint
├── template.tsx     # Re-mounted layout
├── default.tsx      # Parallel route fallback
└── opengraph-image.tsx  # OG image generation
```

## Quick Start

```typescript
// app/layout.tsx
export const metadata = {
  title: { default: 'My App', template: '%s | My App' },
  description: 'Built with Next.js App Router',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body><Providers>{children}</Providers></body>
    </html>
  )
}

// app/page.tsx - Server Component by default
export default async function HomePage() {
  const products = await getProducts() // fetch with { next: { revalidate: 3600 } }
  return <main><ProductGrid products={products} /></main>
}
```

## Patterns

### Pattern 1: Server Components with Data Fetching

```typescript
// app/products/page.tsx
export default async function ProductsPage({
  searchParams,
}: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  return (
    <div className="flex gap-8">
      <FilterSidebar />
      <Suspense key={JSON.stringify(params)} fallback={<ProductListSkeleton />}>
        <ProductList category={params.category} sort={params.sort} page={Number(params.page) || 1} />
      </Suspense>
    </div>
  )
}

// Server Component fetches its own data
export async function ProductList({ category, sort, page }: ProductFilters) {
  const { products, totalPages } = await getProducts({ category, sort, page })
  return (
    <div>
      <div className="grid grid-cols-3 gap-4">
        {products.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
      <Pagination currentPage={page} totalPages={totalPages} />
    </div>
  )
}
```

### Pattern 2: Client Components with 'use client'

```typescript
'use client'
import { useState, useTransition } from 'react'

export function AddToCartButton({ productId }: { productId: string }) {
  const [isPending, startTransition] = useTransition()
  const handleClick = () => {
    startTransition(async () => {
      const result = await addToCart(productId)
      if (result.error) setError(result.error)
    })
  }
  return <button onClick={handleClick} disabled={isPending}>
    {isPending ? 'Adding...' : 'Add to Cart'}
  </button>
}
```

### Pattern 3: Server Actions

```typescript
"use server";
import { revalidateTag } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function addToCart(productId: string) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session")?.value;
  if (!sessionId) redirect("/login");

  try {
    await db.cart.upsert({
      where: { sessionId_productId: { sessionId, productId } },
      update: { quantity: { increment: 1 } },
      create: { sessionId, productId, quantity: 1 },
    });
    revalidateTag("cart");
    return { success: true };
  } catch (error) {
    return { error: "Failed to add item to cart" };
  }
}
```

### Pattern 4: Parallel Routes

```typescript
// app/dashboard/layout.tsx
export default function DashboardLayout({
  children, analytics, team,
}: { children: React.ReactNode; analytics: React.ReactNode; team: React.ReactNode }) {
  return (
    <div className="dashboard-grid">
      <main>{children}</main>
      <aside>{analytics}</aside>
      <aside>{team}</aside>
    </div>
  )
}
// app/dashboard/@analytics/page.tsx — each slot loads independently
```

### Pattern 5: Intercepting Routes (Modal Pattern)

```
File structure:
app/
├── @modal/(.)photos/[id]/page.tsx  # Intercept → shows modal
├── @modal/default.tsx
├── photos/[id]/page.tsx            # Full page fallback
└── layout.tsx                      # Renders {children} + {modal}
```

```typescript
// app/@modal/(.)photos/[id]/page.tsx
export default async function PhotoModal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const photo = await getPhoto(id)
  return <Modal><PhotoDetail photo={photo} /></Modal>
}
```

### Pattern 6: Streaming with Suspense

```typescript
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const product = await getProduct(id) // blocking

  return (
    <div>
      <ProductHeader product={product} />
      <Suspense fallback={<ReviewsSkeleton />}>
        <Reviews productId={id} />  {/* streams in */}
      </Suspense>
      <Suspense fallback={<RecommendationsSkeleton />}>
        <Recommendations productId={id} />  {/* streams in */}
      </Suspense>
    </div>
  )
}
```

### Pattern 7: Route Handlers (API Routes)

```typescript
// app/api/products/route.ts
export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get("category");
  const products = await db.product.findMany({
    where: category ? { category } : undefined, take: 20,
  });
  return NextResponse.json(products);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const product = await db.product.create({ data: body });
  return NextResponse.json(product, { status: 201 });
}
```

### Pattern 8: Metadata and SEO

```typescript
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const product = await getProduct(slug)
  if (!product) return {}
  return {
    title: product.name,
    description: product.description,
    openGraph: { title: product.name, images: [{ url: product.image, width: 1200, height: 630 }] },
  }
}

export async function generateStaticParams() {
  const products = await db.product.findMany({ select: { slug: true } })
  return products.map((p) => ({ slug: p.slug }))
}
```

## Caching Strategies

```typescript
fetch(url, { cache: "no-store" });              // No cache (always fresh)
fetch(url, { cache: "force-cache" });            // Cache forever (static)
fetch(url, { next: { revalidate: 60 } });        // ISR - revalidate after 60s
fetch(url, { next: { tags: ["products"] } });    // Tag-based invalidation

// Invalidate via Server Action
"use server";
import { revalidateTag, revalidatePath } from "next/cache";
export async function updateProduct(id: string, data: ProductData) {
  await db.product.update({ where: { id }, data });
  revalidateTag("products");
  revalidatePath("/products");
}
```

## Best Practices

### Do's

- **Start with Server Components** - Add 'use client' only when needed
- **Colocate data fetching** - Fetch data where it's used
- **Use Suspense boundaries** - Enable streaming for slow data
- **Leverage parallel routes** - Independent loading states
- **Use Server Actions** - For mutations with progressive enhancement

### Don'ts

- **Don't pass serializable data** - Server to Client boundary limitations
- **Don't use hooks in Server Components** - No useState, useEffect
- **Don't fetch in Client Components** - Use Server Components or React Query
- **Don't over-nest layouts** - Each layout adds to the component tree
- **Don't ignore loading states** - Always provide loading.tsx or Suspense

## Resources

- [Next.js App Router Documentation](https://nextjs.org/docs/app)
- [Server Components RFC](https://github.com/reactjs/rfcs/blob/main/text/0188-server-components.md)
