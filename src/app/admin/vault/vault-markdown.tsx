'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** No HTML or image requests from model output, including remote tracking pixels. */
export function VaultMarkdown({ children }: { children: string }) {
  return <div className="min-w-0 space-y-3 break-words text-sm leading-7 text-slate-200"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    img: () => null,
    a: ({ children }) => <span className="underline decoration-slate-500 underline-offset-4">{children}</span>,
    h1: ({ children }) => <h2 className="mt-5 text-xl font-semibold text-white">{children}</h2>,
    h2: ({ children }) => <h3 className="mt-4 text-lg font-semibold text-white">{children}</h3>,
    h3: ({ children }) => <h4 className="mt-3 font-semibold text-white">{children}</h4>,
    ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
    table: ({ children }) => <div className="max-w-full overflow-x-auto rounded-xl border border-slate-700"><table className="w-full text-left text-xs">{children}</table></div>,
    th: ({ children }) => <th className="border-b border-slate-700 bg-slate-950/60 px-3 py-2 font-semibold text-slate-100">{children}</th>,
    td: ({ children }) => <td className="border-b border-slate-800 px-3 py-2 align-top">{children}</td>,
    pre: ({ children }) => <pre className="overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-relaxed">{children}</pre>,
    code: ({ children }) => <code className="rounded bg-slate-950/60 px-1 py-0.5 font-mono text-emerald-200">{children}</code>,
    blockquote: ({ children }) => <blockquote className="border-l-2 border-emerald-600 pl-4 text-slate-300">{children}</blockquote>,
  }}>{children}</ReactMarkdown></div>;
}
