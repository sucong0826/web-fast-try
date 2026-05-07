import styles from "../styles.module.css";

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className={styles.emptyState}>
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}
