/* 嵌入式页面 —— 把零构建的独立工具页接进主系统
   汇总工具页与智能体演示页都是自包含 HTML，由后端直接托管；
   这里用 iframe 嵌入，好处是：不动它们的源码、不需要重新构建、
   主系统的顶栏导航始终在，用户不用记 /merge、/agent 这种地址。 */

interface EmbeddedProps {
  /** 后端托管路径，如 /merge、/agent */
  src: string
  /** 无浏览器 file 协议限制时的备用链接文字 */
  title: string
}

export default function Embedded({ src, title }: EmbeddedProps) {
  return (
    <div className="embedded-wrap">
      <div className="embedded-bar">
        <span className="embedded-title">{title}</span>
        <a className="embedded-open" href={src} target="_blank" rel="noreferrer">
          在新标签页打开 ↗
        </a>
      </div>
      <iframe
        className="embedded-frame"
        src={src}
        title={title}
        /* 同源页面，脚本要能跑（汇总页要 fetch /api/merge） */
        sandbox="allow-same-origin allow-scripts allow-downloads allow-forms allow-popups"
      />
    </div>
  )
}
