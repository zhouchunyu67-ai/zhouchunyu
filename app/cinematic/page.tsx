"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cinematicCategories, cinematicEntries, cinematicEntryTotal, type CinematicEntry } from "../cinematicCatalog";

const localEntries = cinematicEntries;

export default function CinematicLibraryPage() {
  const [activeCategoryId, setActiveCategoryId] = useState(() => {
    if (typeof window === "undefined") return "lighting";
    const requested = new URLSearchParams(window.location.search).get("category")?.toLowerCase();
    return cinematicCategories.some((category) => category.id === requested) ? requested! : "lighting";
  });
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [notice, setNotice] = useState("");

  const activeCategory = cinematicCategories.find((category) => category.id === activeCategoryId) ?? cinematicCategories[0];
  const visibleEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return localEntries.filter((entry) => {
      const inCategory = activeCategoryId === "all" || entry.categoryId === activeCategoryId;
      const searchable = `${entry.title}${entry.summary}${entry.template}`.toLowerCase();
      return inCategory && (!keyword || searchable.includes(keyword));
    });
  }, [activeCategoryId, query]);

  const copyEntry = async (entry: CinematicEntry) => {
    try {
      await navigator.clipboard.writeText(entry.template);
      setNotice(`已复制：${entry.title}`);
      window.setTimeout(() => setNotice(""), 1800);
    } catch {
      setNotice("复制失败，请检查浏览器剪贴板权限");
    }
  };

  return (
    <main className="cinematic-page">
      <header className="cinematic-page-header">
        <Link className="cinematic-back" href="/" aria-label="返回素材库">←</Link>
        <div>
          <span>FRAME VAULT / CINEMATIQUE</span>
          <h1>电影技法与胶片词典</h1>
          <p>把摄影、灯光、构图、剪辑、胶片和资产模板集中到本地创作工作台。</p>
        </div>
        <div className="cinematic-page-stats"><strong>{activeCategoryId === "all" ? cinematicEntryTotal : activeCategory.count}</strong><span>{activeCategoryId === "all" ? "个真实模板" : "条词条"}</span></div>
      </header>

      <div className="cinematic-page-layout">
        <aside className="cinematic-page-sidebar">
          <div className="cinematic-sidebar-section-title"><span>板块</span><b>{cinematicEntryTotal}</b></div>
          <label className="cinematic-page-search">
            <strong>搜索（多词 / 中英别名）</strong>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入关键词" aria-label="搜索电影化词条" />
          </label>
          <button className="cinematic-combo-button" type="button" onClick={() => setNotice("组合篮功能已预留，可继续加入常用模板")}>组合篮 · 0</button>
          <div className="cinematic-sidebar-tools"><strong>搜索与工具</strong><b>＋</b></div>
          <button type="button" className={`cinematic-sidebar-category ${activeCategoryId === "all" ? "active" : ""}`} onClick={() => setActiveCategoryId("all")}><span>全部</span><b>{cinematicEntryTotal}</b></button>
          <nav className="cinematic-page-category-nav" aria-label="电影化词条分类">
            {cinematicCategories.map((category) => (
              <button type="button" key={category.id} className={activeCategoryId === category.id ? "active" : ""} onClick={() => setActiveCategoryId(category.id)}>
                <span>{category.name}</span><b>{category.count}</b>
              </button>
            ))}
          </nav>
          <small className="cinematic-sidebar-note">本地整理 · 点击分类查看词条</small>
        </aside>

        <section className="cinematic-page-content">
          <div className="cinematic-content-heading">
            <div><span>{activeCategoryId === "all" ? "全部板块" : activeCategory.name} · {activeCategoryId === "all" ? cinematicEntryTotal : activeCategory.count} 条目</span><h2>{activeCategoryId === "all" ? "全部电影化参数" : activeCategory.name}</h2></div>
            <b>{visibleEntries.length} 个真实模板</b>
          </div>
          <div className="cinematic-entry-grid">
            {visibleEntries.map((entry, index) => {
              return (
              <article className="cinematic-full-card" key={entry.id}>
                <div className="cinematic-card-image has-image">
                  {/* Source images must remain byte-for-byte aligned with the reference library. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={entry.image} alt={entry.imageAlt} loading="lazy" decoding="async" />
                  <span>21:9 · FRAME</span>
                </div>
                <div className="cinematic-card-body">
                  <div className="cinematic-card-kicker"><small>{String(index + 1).padStart(2, "0")}</small><em>{activeCategoryId === "all" ? cinematicCategories.find((category) => category.id === entry.categoryId)?.name : activeCategory.name}</em></div>
                  <h3>{entry.title}</h3>
                  <p className="cinematic-card-summary">{entry.summary}</p>
                  <div className="cinematic-card-prompt">{entry.template}</div>
                  <div className="cinematic-card-actions">
                    <span>保持 [Subject]，或按需替换后复制。</span>
                    <button type="button" onClick={() => void copyEntry(entry)}>复制提示词</button>
                  </div>
                  <div className="cinematic-card-footer">
                    <button type="button" onClick={() => setFavorites((current) => current.includes(entry.id) ? current.filter((id) => id !== entry.id) : [...current, entry.id])}>{favorites.includes(entry.id) ? "★ 已收藏" : "☆ 收藏"}</button>
                    <button type="button" onClick={() => setNotice(`已加入组合：${entry.title}`)}>加入组合</button>
                    <button type="button" onClick={() => void copyEntry(entry)}>复制核心</button>
                  </div>
                </div>
              </article>
              );
            })}
          </div>
          {!visibleEntries.length && <div className="cinematic-empty-state">没有匹配的电影化词条，请换一个分类或关键词。</div>}
        </section>
      </div>
      {notice && <div className="cinematic-toast" role="status">{notice}</div>}
    </main>
  );
}
