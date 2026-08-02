import type { ReactNode } from 'react';

interface ProductSectionProps {
    id: string;
    eyebrow: string;
    title: string;
    introduction?: string;
    children: ReactNode;
}

export default function ProductSection({
    id,
    eyebrow,
    title,
    introduction,
    children,
}: ProductSectionProps) {
    return (
        <section className="product-section" id={id}>
            <div className="product-section-heading">
                <span className="product-eyebrow">{eyebrow}</span>
                <h2>{title}</h2>
                {introduction && <p>{introduction}</p>}
            </div>
            {children}
        </section>
    );
}
