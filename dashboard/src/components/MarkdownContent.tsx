import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="min-w-0 text-sm leading-7 text-slate-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mb-4 mt-1 text-2xl font-semibold text-slate-950">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-3 mt-7 border-b border-slate-200 pb-2 text-xl font-semibold text-slate-950">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-6 text-base font-semibold text-slate-900">{children}</h3>,
          h4: ({ children }) => <h4 className="mb-2 mt-5 text-sm font-semibold text-slate-900">{children}</h4>,
          p: ({ children }) => <p className="my-3 break-words">{children}</p>,
          ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-6 marker:text-slate-400">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-6 marker:text-slate-500">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-4 border-l-4 border-clay-200 bg-clay-50 px-4 py-2 text-slate-600">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-6 border-slate-200" />,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-clay-700 underline decoration-clay-300 underline-offset-2 hover:text-clay-800"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-slate-100 text-slate-800">{children}</thead>,
          th: ({ children }) => <th className="border-b border-slate-200 px-3 py-2 font-semibold">{children}</th>,
          td: ({ children }) => <td className="border-b border-slate-100 px-3 py-2 align-top last:border-b-0">{children}</td>,
          pre: ({ children }) => (
            <pre className="my-4 max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-ink-900 p-4 font-mono text-xs leading-6 text-slate-100">
              {children}
            </pre>
          ),
          code: ({ className, children }) => className ? (
            <code className={`${className} font-mono`}>{children}</code>
          ) : (
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-slate-800">
              {children}
            </code>
          ),
          strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
          img: ({ src, alt }) => (
            <img src={src} alt={alt || ''} className="my-4 max-h-[28rem] max-w-full rounded-lg border border-slate-200 object-contain" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownContent;
