import Reveal from "./Reveal";
import styles from "./SectionHead.module.css";

/**
 * The header that defines an open section.
 *
 * Sections on this page used to be delimited by a rounded rectangle. The ones
 * that do not need containment are delimited by this instead: an eyebrow, a
 * headline set larger than anything inside the section, an optional figure on
 * the right, and a hairline. Type and space do the work the border used to.
 *
 * The heading is always an `h3`, because the rail and the header navigate to
 * these sections and a reader moving by headings has to find them.
 */
export default function SectionHead({
  eyebrow,
  title,
  caption,
  meta,
  id,
}: {
  eyebrow: string;
  title: string;
  /** Sits under the headline — what the section is for. */
  caption?: string;
  /** Sits opposite the headline — a count, a figure, a qualifier. */
  meta?: React.ReactNode;
  id?: string;
}) {
  return (
    <Reveal className={styles.head}>
      <div className={styles.top}>
        <div className={styles.titles}>
          <div className="eyebrow">{eyebrow}</div>
          <h3 id={id} className={`display ${styles.title}`}>
            {title}
          </h3>
        </div>
        {meta && <div className={styles.meta}>{meta}</div>}
      </div>

      {caption && <p className={styles.caption}>{caption}</p>}

      <div className={styles.rule} aria-hidden="true" />
    </Reveal>
  );
}
