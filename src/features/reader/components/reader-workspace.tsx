"use client";

import {
  ArrowLeft,
  Archive,
  BookOpenText,
  Check,
  CircleDot,
  ExternalLink,
  Folder,
  Inbox,
  LoaderCircle,
  Menu,
  Palette,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Star,
  X,
} from "lucide-react";
import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";

import { LogoutButton } from "@/features/auth/components/logout-button";
import {
  articleDetailDataSchema,
  articlePageSchema,
  articleStateDataSchema,
  categoryListDataSchema,
  createdFeedDataSchema,
  feedListDataSchema,
  refreshFeedDataSchema,
  type ArticleDetail,
  type ArticleListItem,
  type ArticlePage,
  type CategoryListItem,
} from "@/features/reader/schemas/reader-schema";
import { browserApiRequest } from "@/lib/api/browser-api";
import { cn } from "@/lib/styling/cn";

type ReaderFilter = "all" | "unread" | "starred";

export function ReaderWorkspace({ username, demoMode = false }: { username: string; demoMode?: boolean }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ReaderFilter>("all");
  const [feedId, setFeedId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [isAddFeedOpen, setIsAddFeedOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobileReaderOpen, setIsMobileReaderOpen] = useState(false);

  const feedsQuery = useQuery({
    queryKey: ["feeds"],
    queryFn: () => browserApiRequest("/api/feeds", feedListDataSchema),
  });

  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => browserApiRequest("/api/categories", categoryListDataSchema),
  });

  const articlesQuery = useInfiniteQuery({
    queryKey: ["articles", { filter, feedId, categoryId, query }],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();

      if (feedId) params.set("feedId", feedId);
      if (categoryId) params.set("categoryId", categoryId);
      if (query.trim()) params.set("query", query.trim());
      if (filter === "unread") params.set("unread", "true");
      if (filter === "starred") params.set("starred", "true");
      if (pageParam) params.set("cursor", pageParam);

      return browserApiRequest(`/api/articles?${params.toString()}`, articlePageSchema);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const articleItems = articlesQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const effectiveArticleId = articleItems.some((item) => item.id === selectedArticleId)
    ? selectedArticleId
    : articleItems[0]?.id ?? null;
  const selectedListItem = articleItems.find((item) => item.id === effectiveArticleId);

  const articleQuery = useQuery({
    queryKey: ["article", effectiveArticleId],
    queryFn: () => browserApiRequest(`/api/articles/${effectiveArticleId}`, articleDetailDataSchema),
    enabled: Boolean(effectiveArticleId),
  });

  const stateMutation = useMutation({
    mutationFn: ({ articleId, patch }: { articleId: string; patch: { isRead?: boolean; isStarred?: boolean } }) =>
      browserApiRequest(`/api/articles/${articleId}`, articleStateDataSchema, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onMutate: async ({ articleId, patch }) => {
      await queryClient.cancelQueries({ queryKey: ["articles"] });
      const snapshots = queryClient.getQueriesData<InfiniteData<ArticlePage>>({ queryKey: ["articles"] });

      for (const [key, data] of snapshots) {
        if (!data) continue;
        queryClient.setQueryData<InfiniteData<ArticlePage>>(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((item) => (item.id === articleId ? { ...item, ...patch } : item)),
          })),
        });
      }

      queryClient.setQueryData<{ article: ArticleDetail }>(["article", articleId], (current) =>
        current ? { article: { ...current.article, ...patch } } : current,
      );

      return { snapshots };
    },
    onError: (_error, _variables, context) => {
      for (const [key, page] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, page);
      }
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["articles"] });
      void queryClient.invalidateQueries({ queryKey: ["article", variables.articleId] });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: (id: string) => browserApiRequest(`/api/feeds/${id}/refresh`, refreshFeedDataSchema, { method: "POST" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["feeds"] }),
        queryClient.invalidateQueries({ queryKey: ["articles"] }),
      ]);
    },
  });

  function selectArticle(article: ArticleListItem) {
    setSelectedArticleId(article.id);
    setIsMobileReaderOpen(true);

    if (!article.isRead) {
      stateMutation.mutate({ articleId: article.id, patch: { isRead: true } });
    }
  }

  const selectedFeed = feedsQuery.data?.feeds.find((feed) => feed.id === feedId);
  const selectedCategory = categoriesQuery.data?.categories.find((category) => category.id === categoryId);

  return (
    <main className="min-h-dvh bg-background p-0 sm:p-3">
      <div className="mx-auto grid min-h-dvh max-w-[1760px] overflow-hidden bg-surface sm:min-h-[calc(100dvh-1.5rem)] sm:rounded-[var(--radius-lg)] sm:border sm:border-border sm:shadow-[var(--shadow)] lg:grid-cols-[260px_390px_minmax(0,1fr)]">
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 flex w-[280px] -translate-x-full flex-col border-r border-border bg-surface-muted p-4 shadow-[var(--shadow-strong)] transition-transform lg:static lg:z-auto lg:w-auto lg:translate-x-0 lg:shadow-none",
            isSidebarOpen && "translate-x-0",
          )}
        >
          <div className="flex items-center gap-3 px-2 py-3">
            <span className="grid size-10 place-items-center rounded-xl bg-foreground text-inverse-foreground">
              <Rss aria-hidden className="size-4" />
            </span>
            <div>
              <p className="font-semibold">Fulltext RSS Reader</p>
              <p className="text-xs text-subtle">私人全文阅读器</p>
            </div>
            <button
              type="button"
              aria-label="关闭导航"
              onClick={() => setIsSidebarOpen(false)}
              className="ml-auto rounded-lg p-2 text-muted hover:bg-surface lg:hidden"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>

          <nav aria-label="主要导航" className="mt-7 space-y-1">
            <NavButton
              icon={Inbox}
              label="收件箱"
              active={filter === "all" && !feedId}
              onClick={() => {
                setFilter("all");
                setFeedId(null);
                setCategoryId(null);
                setIsSidebarOpen(false);
              }}
            />
            <NavButton
              icon={CircleDot}
              label="未读"
              active={filter === "unread" && !feedId}
              onClick={() => {
                setFilter("unread");
                setFeedId(null);
                setCategoryId(null);
                setIsSidebarOpen(false);
              }}
            />
            <NavButton
              icon={Star}
              label="收藏"
              active={filter === "starred" && !feedId}
              onClick={() => {
                setFilter("starred");
                setFeedId(null);
                setCategoryId(null);
                setIsSidebarOpen(false);
              }}
            />
            <NavButton
              icon={Archive}
              label="全部文章"
              active={false}
              onClick={() => {
                setFilter("all");
                setFeedId(null);
                setCategoryId(null);
                setIsSidebarOpen(false);
              }}
            />
          </nav>

          {categoriesQuery.data?.categories.length ? (
            <div className="mt-7">
              <p className="px-3 text-xs font-semibold text-subtle uppercase">分类</p>
              <div className="mt-2 space-y-1">
                {categoriesQuery.data.categories.map((category) => (
                  <NavButton
                    key={category.id}
                    icon={Folder}
                    label={`${category.name} · ${category.feedCount}`}
                    active={categoryId === category.id}
                    onClick={() => {
                      setCategoryId(category.id);
                      setFeedId(null);
                      setFilter("all");
                      setIsSidebarOpen(false);
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-8 flex items-center justify-between px-3">
            <p className="text-xs font-semibold text-subtle uppercase">订阅</p>
            <button
              type="button"
              aria-label="添加订阅"
              onClick={() => setIsAddFeedOpen(true)}
              className="rounded-md p-1.5 text-muted hover:bg-surface"
            >
              <Plus aria-hidden className="size-4" />
            </button>
          </div>

          <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
            {feedsQuery.isPending ? <SidebarStatus label="正在读取订阅" /> : null}
            {feedsQuery.isError ? <SidebarStatus label="订阅加载失败" danger /> : null}
            {feedsQuery.data?.feeds.length === 0 ? (
              <button
                type="button"
                onClick={() => setIsAddFeedOpen(true)}
                className="w-full rounded-xl border border-dashed border-border-strong px-3 py-4 text-left text-sm leading-6 text-muted hover:bg-surface"
              >
                尚未添加订阅。
                <br />
                可从 Example Engineering 开始。
              </button>
            ) : null}
            {feedsQuery.data?.feeds.map((feed) => (
              <button
                key={feed.id}
                type="button"
                onClick={() => {
                  setFeedId(feed.id);
                  setCategoryId(null);
                  setFilter("all");
                  setIsSidebarOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition",
                  feedId === feed.id ? "bg-surface-selected font-medium text-foreground shadow-[var(--shadow-control)]" : "text-muted hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-xs font-bold text-accent-strong">
                  {feed.title.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate">{feed.title}</span>
                {feed.lastErrorCode ? <span title={feed.lastErrorMessage ?? "刷新失败"} className="size-2 rounded-full bg-danger" /> : null}
              </button>
            ))}
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0 px-2">
                <p className="truncate text-sm font-medium">{username}</p>
                <p className="text-xs text-subtle">单用户空间</p>
              </div>
              <LogoutButton />
            </div>
            <Link
              href="/settings/appearance"
              className="mt-2 flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-muted transition hover:bg-surface-hover hover:text-foreground"
            >
              <Palette aria-hidden className="size-4" />
              外观设置
            </Link>
          </div>
        </aside>

        {isSidebarOpen ? (
          <button
            type="button"
            aria-label="关闭导航遮罩"
            className="fixed inset-0 z-30 bg-overlay lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        ) : null}

        <section className={cn("min-w-0 border-r border-border bg-surface", isMobileReaderOpen && "hidden md:block")}>
          <header className="border-b border-border px-4 py-4 sm:px-5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="打开导航"
                onClick={() => setIsSidebarOpen(true)}
                className="rounded-lg border border-border p-2 text-muted hover:bg-surface-muted lg:hidden"
              >
                <Menu aria-hidden className="size-4" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-accent uppercase">
                  {filter === "unread" ? "Unread" : filter === "starred" ? "Starred" : selectedFeed?.title ?? selectedCategory?.name ?? "Inbox"}
                </p>
                <h1 className="mt-1 truncate font-serif text-2xl font-semibold">
                  {filter === "unread" ? "未读文章" : filter === "starred" ? "收藏文章" : selectedFeed?.title ?? selectedCategory?.name ?? "今天的阅读"}
                </h1>
              </div>
              <button
                type="button"
                aria-label="刷新当前订阅"
                disabled={!feedId || refreshMutation.isPending}
                onClick={() => feedId && refreshMutation.mutate(feedId)}
                className="rounded-lg border border-border p-2 text-muted hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCw aria-hidden className={cn("size-4", refreshMutation.isPending && "animate-spin")} />
              </button>
              <button
                type="button"
                aria-label="添加订阅"
                onClick={() => setIsAddFeedOpen(true)}
                className="rounded-lg bg-control-background p-2 text-control-foreground hover:bg-control-hover-background"
              >
                <Plus aria-hidden className="size-4" />
              </button>
            </div>

            <label className="mt-4 flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-muted">
              <Search aria-hidden className="size-4" />
              <span className="sr-only">搜索文章</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题、作者或摘要"
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-placeholder"
              />
              {query ? (
                <button type="button" aria-label="清空搜索" onClick={() => setQuery("")} className="rounded p-1 hover:bg-surface-muted">
                  <X aria-hidden className="size-3.5" />
                </button>
              ) : null}
            </label>
          </header>

          <div className="h-[calc(100dvh-8.85rem)] overflow-y-auto sm:h-[calc(100dvh-10.35rem)]">
            {articlesQuery.isPending ? <ListStatus icon={LoaderCircle} title="正在整理文章" spin /> : null}
            {articlesQuery.isError ? <ListStatus icon={RefreshCw} title="文章加载失败" description="请稍后刷新重试。" /> : null}
            {articleItems.length === 0 && !articlesQuery.isPending ? (
              <ListStatus
                icon={BookOpenText}
                title={feedsQuery.data?.feeds.length ? "没有符合条件的文章" : "等待第一条订阅"}
                description={feedsQuery.data?.feeds.length ? "试试切换筛选或搜索关键词。" : "添加 RSS 或 Atom 地址后，文章会聚合在这里。"}
              />
            ) : null}
            <div className="divide-y divide-border">
              {articleItems.map((article) => (
                <button
                  key={article.id}
                  type="button"
                  onClick={() => selectArticle(article)}
                  className={cn(
                    "block w-full px-5 py-5 text-left transition hover:bg-surface-hover",
                    effectiveArticleId === article.id && "bg-surface-selected",
                  )}
                >
                  <div className="flex items-center gap-2 text-xs text-subtle">
                    {!article.isRead ? <span aria-label="未读" className="size-2 rounded-full bg-accent" /> : null}
                    <span className="min-w-0 flex-1 truncate font-medium text-accent-strong">{article.feedTitle}</span>
                    <time dateTime={article.publishedAt ?? undefined}>{formatDate(article.publishedAt ?? article.sortDate)}</time>
                    {article.isStarred ? <Star aria-label="已收藏" className="size-3.5 fill-accent text-accent" /> : null}
                  </div>
                  <h2 className={cn("mt-2 font-serif text-xl leading-7", article.isRead ? "font-medium text-muted" : "font-semibold text-foreground")}>
                    {article.title}
                  </h2>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{article.summary ?? "打开文章读取全文。"}</p>
                </button>
              ))}
            </div>
            {articlesQuery.hasNextPage ? (
              <div className="border-t border-border p-4 text-center">
                <button
                  type="button"
                  disabled={articlesQuery.isFetchingNextPage}
                  onClick={() => void articlesQuery.fetchNextPage()}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-muted hover:bg-surface-muted disabled:opacity-60"
                >
                  {articlesQuery.isFetchingNextPage ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
                  {articlesQuery.isFetchingNextPage ? "正在加载" : "加载更多"}
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <section className={cn("min-w-0 bg-surface-raised", !isMobileReaderOpen && "hidden md:block")}>
          {effectiveArticleId ? (
            <ArticleReader
              article={articleQuery.data?.article}
              isPending={articleQuery.isPending}
              isError={articleQuery.isError}
              fallback={selectedListItem}
              onBack={() => setIsMobileReaderOpen(false)}
              onToggleStar={(isStarred) =>
                stateMutation.mutate({ articleId: effectiveArticleId, patch: { isStarred } })
              }
            />
          ) : (
            <EmptyReader onAddFeed={() => setIsAddFeedOpen(true)} />
          )}
        </section>
      </div>

      {isAddFeedOpen ? (
        <AddFeedDialog
          categories={categoriesQuery.data?.categories ?? []}
          demoMode={demoMode}
          onClose={() => setIsAddFeedOpen(false)}
          onCreated={async () => {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["feeds"] }),
              queryClient.invalidateQueries({ queryKey: ["articles"] }),
              queryClient.invalidateQueries({ queryKey: ["categories"] }),
            ]);
            setIsAddFeedOpen(false);
          }}
        />
      ) : null}
    </main>
  );
}

function ArticleReader({
  article,
  fallback,
  isPending,
  isError,
  onBack,
  onToggleStar,
}: {
  article?: ArticleDetail;
  fallback?: ArticleListItem;
  isPending: boolean;
  isError: boolean;
  onBack: () => void;
  onToggleStar: (value: boolean) => void;
}) {
  const visibleArticle = article ?? fallback;

  if (isPending && !visibleArticle) {
    return <ListStatus icon={LoaderCircle} title="正在提取全文" description="首次打开可能需要几秒。" spin />;
  }

  if (isError || !visibleArticle) {
    return <ListStatus icon={RefreshCw} title="文章加载失败" description="请返回列表后重试。" />;
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col sm:h-[calc(100dvh-1.5rem)]">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <button type="button" onClick={onBack} className="rounded-lg p-2 text-muted hover:bg-surface-muted md:hidden" aria-label="返回文章列表">
          <ArrowLeft aria-hidden className="size-4" />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted">{visibleArticle.feedTitle}</span>
        <button
          type="button"
          onClick={() => onToggleStar(!visibleArticle.isStarred)}
          aria-label={visibleArticle.isStarred ? "取消收藏" : "收藏文章"}
          className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-accent"
        >
          <Star aria-hidden className={cn("size-4", visibleArticle.isStarred && "fill-accent text-accent")} />
        </button>
        <a
          href={visibleArticle.url}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
          aria-label="打开原文"
        >
          <ExternalLink aria-hidden className="size-4" />
        </a>
      </header>

      <article className="min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-10 lg:px-12 xl:px-16">
        <div className="mx-auto max-w-[760px]">
          <p className="text-xs font-semibold text-accent uppercase">{visibleArticle.feedTitle}</p>
          <h1 className="mt-4 font-serif text-4xl leading-[1.15] font-semibold sm:text-5xl">{visibleArticle.title}</h1>
          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-subtle">
            {visibleArticle.author ? <span>{visibleArticle.author}</span> : null}
            {visibleArticle.author ? <span aria-hidden>·</span> : null}
            <time dateTime={visibleArticle.publishedAt ?? undefined}>{formatLongDate(visibleArticle.publishedAt)}</time>
          </div>

          {article?.usedFallback ? (
            <div className="mt-7 rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm leading-6 text-muted">
              原网页全文暂时无法提取，当前显示订阅源提供的内容。
            </div>
          ) : null}

          {isPending ? (
            <div className="mt-10 flex items-center gap-3 text-sm text-muted">
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
              正在提取并清洗全文…
            </div>
          ) : null}

          {article?.contentHtml ? (
            <div className="article-content mt-10" dangerouslySetInnerHTML={{ __html: article.contentHtml }} />
          ) : (
            <p className="mt-10 font-serif text-lg leading-8 text-muted">{visibleArticle.summary ?? "该文章没有可显示的摘要，请打开原文阅读。"}</p>
          )}

          <div className="mt-14 border-t border-border pt-6">
            <a href={visibleArticle.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-accent hover:text-accent-strong">
              阅读原网页
              <ExternalLink aria-hidden className="size-4" />
            </a>
          </div>
        </div>
      </article>
    </div>
  );
}

function AddFeedDialog({
  categories,
  demoMode,
  onClose,
  onCreated,
}: {
  categories: CategoryListItem[];
  demoMode: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [url, setUrl] = useState("https://example.com/rss.xml");
  const [categoryName, setCategoryName] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      browserApiRequest("/api/feeds", createdFeedDataSchema, {
        method: "POST",
        body: JSON.stringify({ url, ...(categoryName.trim() ? { categoryName: categoryName.trim() } : {}) }),
      }),
    onSuccess: onCreated,
  });

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !mutation.isPending) {
        onClose();
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mutation.isPending, onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-overlay-strong p-4" role="presentation" onMouseDown={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-feed-title"
        className="w-full max-w-lg rounded-[var(--radius-lg)] border border-border bg-surface p-6 shadow-[var(--shadow-strong)] sm:p-8"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-accent uppercase">New subscription</p>
            <h2 id="add-feed-title" className="mt-2 font-serif text-3xl font-semibold">添加订阅</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-lg p-2 text-muted hover:bg-surface-muted">
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <p className="mt-4 text-sm leading-6 text-muted">
          {demoMode
            ? "输入 RSS 或 Atom 地址。添加后会立即抓取；共享演示不运行后台刷新，可在订阅中手动刷新（10 分钟冷却）。"
            : "输入 RSS 或 Atom 地址。添加后会立即抓取，之后每 30 分钟自动刷新。"}
        </p>
        <label className="mt-6 block space-y-2">
          <span className="text-sm font-medium">订阅地址</span>
          <input
            autoFocus
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            inputMode="url"
            className="h-12 w-full rounded-lg border border-border bg-background px-4 outline-none focus:border-accent"
          />
        </label>

        <label className="mt-4 block space-y-2">
          <span className="text-sm font-medium">分类（可选）</span>
          <input
            value={categoryName}
            onChange={(event) => setCategoryName(event.target.value)}
            list="feed-category-options"
            placeholder="例如：个人博客"
            className="h-12 w-full rounded-lg border border-border bg-background px-4 outline-none focus:border-accent"
          />
          <datalist id="feed-category-options">
            {categories.map((category) => <option key={category.id} value={category.name} />)}
          </datalist>
        </label>

        {mutation.isError ? (
          <p role="alert" className="mt-4 text-sm text-danger">{getErrorMessage(mutation.error)}</p>
        ) : null}

        <div className="mt-7 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="h-11 rounded-lg px-4 text-sm font-medium text-muted hover:bg-surface-muted">取消</button>
          <button
            type="submit"
            disabled={!url.trim() || mutation.isPending}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-control-background px-5 text-sm font-semibold text-control-foreground hover:bg-control-hover-background disabled:opacity-60"
          >
            {mutation.isPending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />}
            {mutation.isPending ? "正在验证" : "添加订阅"}
          </button>
        </div>
      </form>
    </div>
  );
}

function EmptyReader({ onAddFeed }: { onAddFeed: () => void }) {
  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <div className="max-w-lg text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-full border border-border bg-surface text-accent shadow-[var(--shadow-control)]">
          <BookOpenText aria-hidden className="size-7" />
        </span>
        <p className="mt-8 text-xs font-semibold text-accent uppercase">Your quiet archive</p>
        <h2 className="mt-3 font-serif text-4xl font-semibold">从一条订阅开始</h2>
        <p className="mx-auto mt-4 max-w-md leading-7 text-muted">添加 RSS 地址后，打开文章即可提取、清洗并缓存全文。</p>
        <button type="button" onClick={onAddFeed} className="mt-7 inline-flex h-11 items-center gap-2 rounded-lg bg-control-background px-5 text-sm font-semibold text-control-foreground hover:bg-control-hover-background">
          <Plus aria-hidden className="size-4" />
          添加第一条订阅
        </button>
      </div>
    </div>
  );
}

function NavButton({ icon: Icon, label, active, onClick }: { icon: typeof Inbox; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition",
        active ? "bg-surface-selected font-medium text-foreground shadow-[var(--shadow-control)]" : "text-muted hover:bg-surface-hover hover:text-foreground",
      )}
    >
      <Icon aria-hidden className="size-4" />
      {label}
    </button>
  );
}

function SidebarStatus({ label, danger = false }: { label: string; danger?: boolean }) {
  return <p className={cn("px-3 py-2 text-sm text-muted", danger && "text-danger")}>{label}</p>;
}

function ListStatus({ icon: Icon, title, description, spin = false }: { icon: typeof Inbox; title: string; description?: string; spin?: boolean }) {
  return (
    <div className="grid min-h-[320px] place-items-center p-8 text-center">
      <div>
        <Icon aria-hidden className={cn("mx-auto size-6 text-accent", spin && "animate-spin")} />
        <p className="mt-4 font-serif text-xl font-semibold">{title}</p>
        {description ? <p className="mt-2 text-sm leading-6 text-muted">{description}</p> : null}
      </div>
    </div>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "请求失败，请稍后重试。";
}

function formatDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value));
}

function formatLongDate(value: string | null) {
  if (!value) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
}
