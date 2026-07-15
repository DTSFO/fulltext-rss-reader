import {
  Archive,
  ArrowLeft,
  BookOpenText,
  CircleDot,
  ExternalLink,
  Folder,
  Inbox,
  Menu,
  RefreshCw,
  Rss,
  Search,
  Star,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

type Filter = "all" | "unread" | "starred";

type Article = {
  id: number;
  feed: string;
  category: string;
  title: string;
  summary: string;
  author: string;
  published: string;
  read: boolean;
  starred: boolean;
  content: string[];
};

const initialArticles: Article[] = [
  {
    id: 1,
    feed: "Engineering Notes",
    category: "技术",
    title: "把 RSS 全文抓取做成可恢复的后台任务",
    summary: "从源站响应、正文抽取到失败重试，拆解一个可靠的单用户阅读管线。",
    author: "Example Author",
    published: "今天 09:40",
    read: false,
    starred: true,
    content: [
      "全文阅读器的难点不只在解析 XML。源站可能返回不完整正文、重定向链或不稳定的内容类型，因此抓取任务需要明确边界。",
      "这个示例将订阅刷新、正文预取和阅读状态分开处理。Worker 负责有界并发与错误记录，Web 端只读取已经规范化的数据。",
      "当正文抽取失败时，系统保留订阅源摘要作为回退，并让下一轮刷新继续尝试，而不是阻塞整个订阅。",
    ],
  },
  {
    id: 2,
    feed: "Product Dispatch",
    category: "产品",
    title: "为高频阅读设计三栏工作区",
    summary: "导航、文章列表和正文同时可见，减少上下文切换。",
    author: "Lin Chen",
    published: "昨天 18:20",
    read: false,
    starred: false,
    content: [
      "桌面端采用稳定的三栏结构：左侧管理订阅与筛选，中间用于快速扫描标题，右侧保留完整阅读上下文。",
      "移动端则把同一流程折叠为导航、列表和正文三个可返回的层级，避免横向滚动。",
    ],
  },
  {
    id: 3,
    feed: "Web Platform Weekly",
    category: "技术",
    title: "在服务端校验每一次跨域抓取",
    summary: "通过地址解析、私网阻断和响应上限降低 SSRF 风险。",
    author: "M. Rivera",
    published: "07-13",
    read: true,
    starred: false,
    content: [
      "用户输入的订阅地址不能直接交给 fetch。每一次重定向都应重新解析目标地址，并拒绝回环、私网和保留地址。",
      "请求还需要连接超时、响应体上限和允许的内容类型，避免远端服务长期占用 Worker。",
    ],
  },
  {
    id: 4,
    feed: "Design Systems",
    category: "设计",
    title: "让主题变量保持可迁移和可回滚",
    summary: "一份版本化主题文件如何支持预览、校验、导入与恢复。",
    author: "Aiko Tan",
    published: "07-12",
    read: true,
    starred: true,
    content: [
      "主题编辑器不直接写入任意 CSS，而是操作受约束的设计令牌。导入时先校验版本、颜色和大小，再生成预览计划。",
      "确认后才写入数据库，同时保留恢复入口。这样可以把外观自由度和运行安全放在同一条流程里。",
    ],
  },
];

const feeds = ["Engineering Notes", "Product Dispatch", "Web Platform Weekly", "Design Systems"];

function App() {
  const [articles, setArticles] = useState(initialArticles);
  const [filter, setFilter] = useState<Filter>("all");
  const [feed, setFeed] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return articles.filter((article) => {
      if (filter === "unread" && article.read) return false;
      if (filter === "starred" && !article.starred) return false;
      if (feed && article.feed !== feed) return false;
      return !normalized || `${article.title} ${article.summary} ${article.feed}`.toLowerCase().includes(normalized);
    });
  }, [articles, feed, filter, query]);

  const selected = visible.find((article) => article.id === selectedId) ?? visible[0] ?? null;

  function choose(article: Article) {
    setSelectedId(article.id);
    setReaderOpen(true);
    setArticles((items) => items.map((item) => item.id === article.id ? { ...item, read: true } : item));
  }

  function refresh() {
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 650);
  }

  function setView(nextFilter: Filter, nextFeed = "") {
    setFilter(nextFilter);
    setFeed(nextFeed);
    setSidebarOpen(false);
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="brand-row">
          <span className="brand-mark"><Rss size={18} /></span>
          <div><strong>Fulltext RSS</strong><small>公开演示数据</small></div>
          <button className="icon-button mobile-only close-nav" onClick={() => setSidebarOpen(false)} aria-label="关闭导航"><X /></button>
        </div>

        <nav aria-label="阅读筛选" className="nav-list">
          <NavButton active={filter === "all" && !feed} icon={<Inbox />} label="收件箱" count={articles.length} onClick={() => setView("all")} />
          <NavButton active={filter === "unread"} icon={<CircleDot />} label="未读" count={articles.filter((item) => !item.read).length} onClick={() => setView("unread")} />
          <NavButton active={filter === "starred"} icon={<Star />} label="收藏" count={articles.filter((item) => item.starred).length} onClick={() => setView("starred")} />
          <NavButton active={false} icon={<Archive />} label="全部文章" count={articles.length} onClick={() => setView("all")} />
        </nav>

        <p className="section-label">订阅</p>
        <div className="feed-list">
          {feeds.map((item) => (
            <button key={item} className={feed === item ? "active" : ""} onClick={() => setView("all", item)}>
              <span>{item.slice(0, 1)}</span><strong>{item}</strong>
            </button>
          ))}
        </div>

        <div className="sidebar-footer"><Folder /><span>4 个订阅 · 3 个分类</span></div>
      </aside>

      <section className={`article-column ${readerOpen ? "mobile-hidden" : ""}`}>
        <header className="column-toolbar">
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(true)} aria-label="打开导航"><Menu /></button>
          <div><p>{feed || (filter === "starred" ? "收藏" : filter === "unread" ? "未读" : "今天的阅读")}</p><small>{visible.length} 篇文章</small></div>
          <button className="icon-button" onClick={refresh} aria-label="刷新订阅"><RefreshCw className={refreshing ? "spin" : ""} /></button>
        </header>

        <label className="search-field"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文章" /></label>

        <div className="article-list">
          {visible.map((article) => (
            <button key={article.id} className={`article-row ${selected?.id === article.id ? "selected" : ""}`} onClick={() => choose(article)}>
              <span className={`unread-dot ${article.read ? "read" : ""}`} />
              <span className="article-copy"><small>{article.feed} · {article.published}</small><strong>{article.title}</strong><span>{article.summary}</span></span>
              {article.starred ? <Star className="starred" size={16} /> : null}
            </button>
          ))}
          {!visible.length ? <div className="empty-state">没有匹配的文章</div> : null}
        </div>
      </section>

      <article className={`reader-pane ${readerOpen ? "is-open" : ""}`}>
        {selected ? (
          <>
            <header className="reader-toolbar">
              <button className="icon-button mobile-only" onClick={() => setReaderOpen(false)} aria-label="返回文章列表"><ArrowLeft /></button>
              <span>{selected.feed}</span>
              <div>
                <button className="icon-button" onClick={() => setArticles((items) => items.map((item) => item.id === selected.id ? { ...item, starred: !item.starred } : item))} aria-label={selected.starred ? "取消收藏" : "收藏文章"}>
                  <Star className={selected.starred ? "starred" : ""} />
                </button>
                <button className="icon-button" aria-label="打开原文"><ExternalLink /></button>
              </div>
            </header>
            <div className="reader-scroll">
              {/* The demo is a standalone Vite build, so Next Image is not available here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="article-image" src={`${import.meta.env.BASE_URL}reading-desk.jpg`} alt="桌面上的笔记本电脑、笔记和咖啡" />
              <p className="article-kicker">{selected.category} · {selected.published}</p>
              <h1>{selected.title}</h1>
              <p className="byline">{selected.author}</p>
              {selected.content.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              <div className="article-end"><BookOpenText /><span>示例正文结束</span></div>
            </div>
          </>
        ) : <div className="reader-empty"><BookOpenText /><span>选择一篇文章开始阅读</span></div>}
      </article>
    </main>
  );
}

function NavButton({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count: number; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick}>{icon}<span>{label}</span><small>{count}</small></button>;
}

createRoot(document.getElementById("root")!).render(<App />);