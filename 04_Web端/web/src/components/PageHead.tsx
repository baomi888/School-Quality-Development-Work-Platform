/* 页头：标题先说明这是什么，范围信息放在标题之后。每个页面至多一个。 */
export default function PageHead({
  kicker,
  title,
  side,
  sideNotes,
  note,
}: {
  /** 标题上方那行红色小字，例如「第 5 周 · 官渡」 */
  kicker: string
  /** 超大标题，用 \n 换行 */
  title: string
  /** 右侧读数块 */
  side?: { value: string; label: string }[]
  /** 右侧读数里另一组次要项（标签在上、数值在下），例如「学院池 7」 */
  sideNotes?: { label: string; value: string }[]
  /** 读数下方的一行补充说明 */
  note?: string
}) {
  return (
    <div className="display">
      <div className="display-main">
        <h1>
          {title.split('\n').map((line, i) => (
            <span key={i} className="display-line">
              {line}
            </span>
          ))}
        </h1>
        <p className="display-kicker">{kicker}</p>
      </div>
      {side && side.length > 0 && (
        <div className="display-side">
          {side.map((s, i) => (
            <div key={i}>
              <span>{s.label}</span>
              <b>{s.value}</b>
            </div>
          ))}
          {sideNotes?.map((s, i) => (
            <span className="display-side-note" key={i}>
              {s.label} {s.value}
            </span>
          ))}
          {note && <span className="display-note">{note}</span>}
        </div>
      )}
    </div>
  )
}
