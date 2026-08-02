interface FlowStep {
    number: string;
    title: string;
    detail: string;
}

interface SystemFlowProps {
    steps: FlowStep[];
    label: string;
}

export default function SystemFlow({ steps, label }: SystemFlowProps) {
    return (
        <ol className="product-flow" aria-label={label}>
            {steps.map((step, index) => (
                <li className="product-flow-step" key={step.number}>
                    <span className="product-flow-number">{step.number}</span>
                    <div>
                        <strong>{step.title}</strong>
                        <p>{step.detail}</p>
                    </div>
                    {index < steps.length - 1 && (
                        <span className="product-flow-arrow" aria-hidden="true">→</span>
                    )}
                </li>
            ))}
        </ol>
    );
}
