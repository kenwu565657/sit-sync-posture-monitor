import { useState } from 'react';
import { Link } from 'react-router-dom';
import ProductSection from '../components/product/ProductSection';
import SystemFlow from '../components/product/SystemFlow';
import './ProductPage.css';

const demoVideoUrl = import.meta.env.VITE_DEMO_VIDEO_URL?.trim();
const posterUrl = '/sit-sync-poster.png';

const pipelineSteps = [
    {
        number: 'A',
        title: 'Five-second history',
        detail: '50 calibrated frames sampled at 10 Hz.',
    },
    {
        number: 'B',
        title: 'Eight features',
        detail: 'Four posture angles plus their movement velocities.',
    },
    {
        number: 'C',
        title: '1D-CNN + LSTM',
        detail: 'Local patterns and longer movement trends are combined.',
    },
    {
        number: 'D',
        title: 'Future risk',
        detail: 'Probability of a sustained event during the next five seconds.',
    },
];

export default function ProductPage() {
    const [posterAvailable, setPosterAvailable] = useState(true);
    const scrollToSection = (id: string) => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    };

    return (
        <div className="product-page">
            <header className="product-header">
                <Link className="product-brand" to="/" aria-label="Sit-Sync home">
                    <img
                        className="product-brand-mark"
                        src="/sit-sync-logo.png"
                        alt=""
                        aria-hidden="true"
                    />
                    <span>Sit-Sync</span>
                </Link>
                <nav className="product-nav" aria-label="Product navigation">
                    <button type="button" onClick={() => scrollToSection('trailer')}>Trailer</button>
                    <button type="button" onClick={() => scrollToSection('poster')}>Poster</button>
                    <button type="button" onClick={() => scrollToSection('modeling')}>Modeling</button>
                </nav>
                <div className="product-header-actions">
                    <Link className="product-link-button" to="/login">Sign in</Link>
                    <Link className="product-primary-button product-compact-button" to="/app">
                        Open portal
                    </Link>
                </div>
            </header>

            <main className="product-simple-main">
                <ProductSection
                    id="trailer"
                    eyebrow="01 · Trailer"
                    title="See Sit-Sync in action"
                    introduction="A short demonstration of sensor connection, posture monitoring, alerts, and history replay."
                >
                    <div className="product-trailer-shell">
                        {demoVideoUrl ? (
                            <video
                                className="product-demo-video"
                                controls
                                preload="metadata"
                                playsInline
                            >
                                <source src={demoVideoUrl} />
                                Your browser does not support embedded video.
                            </video>
                        ) : (
                            <div className="product-video-placeholder">
                                <span className="product-play-mark" aria-hidden="true">▶</span>
                                <div>
                                    <strong>Demo video placeholder</strong>
                                    <p>
                                        Set <code>VITE_DEMO_VIDEO_URL</code> to a public
                                        S3, CloudFront, or streaming URL.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </ProductSection>

                <ProductSection
                    id="poster"
                    eyebrow="02 · Poster"
                    title="Project overview"
                    introduction="Understand Sit-Sync In One Poster"
                >
                    <div className="product-poster-shell">
                        {posterAvailable ? (
                            <img
                                className="product-poster-image"
                                src={posterUrl}
                                alt="Sit-Sync project poster"
                                onError={() => setPosterAvailable(false)}
                            />
                        ) : (
                            <div className="product-poster-placeholder">
                                <strong>Project poster</strong>
                                <p>
                                    Add the poster image as{' '}
                                    <code>web-portal/public/sit-sync-poster.png</code>.
                                </p>
                            </div>
                        )}
                    </div>
                </ProductSection>

                <ProductSection
                    id="modeling"
                    eyebrow="03 · Modeling"
                    title="Five-second posture-risk forecasting"
                    introduction="The CNN-LSTM observes calibrated movement history and estimates whether sustained risky posture is likely during the next five seconds."
                >
                    <SystemFlow steps={pipelineSteps} label="Deep-learning forecast pipeline" />
                    <div className="product-model-note">
                        <div>
                            <span>1D-CNN</span>
                            <strong>Finds short movement patterns</strong>
                        </div>
                        <div>
                            <span>LSTM</span>
                            <strong>Tracks how posture changes over time</strong>
                        </div>
                        <div>
                            <span>Output</span>
                            <strong>Returns a risk probability, not a diagnosis</strong>
                        </div>
                    </div>

                    <div className="product-model-sources">
                        <article>
                            <span>Data source</span>
                            <h3>
                                <a
                                    href="https://amass.is.tue.mpg.de/"
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    AMASS
                                </a>{' '}
                                +{' '}
                                <a
                                    href="https://babel.is.tue.mpg.de/"
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    BABEL
                                </a>{' '}
                                motion capture
                            </h3>
                            <p>
                                Seated and bending trajectories are selected from
                                BABEL-labelled AMASS motion. The common body model
                                provides repeatable movement before physical sensor
                                recordings are available.
                            </p>
                            <p className="product-model-attribution">
                                With thanks to the researchers and contributors behind{' '}
                                <a
                                    href="https://amass.is.tue.mpg.de/"
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    Mahmood et al., AMASS (ICCV 2019)
                                </a>{' '}
                                and{' '}
                                <a
                                    href="https://openaccess.thecvf.com/content/CVPR2021/html/Punnakkal_BABEL_Bodies_Action_and_Behavior_With_English_Labels_CVPR_2021_paper.html"
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    Punnakkal et al., BABEL (CVPR 2021)
                                </a>
                                .
                            </p>
                            <div className="product-model-tags">
                                <b>Motion capture</b>
                                <b>Action labels</b>
                                <b>Trajectory split</b>
                            </div>
                        </article>
                        <article>
                            <span>Sim-to-real path</span>
                            <h3>Motion → Blender → virtual BNO085</h3>
                            <p>
                                Four virtual sensors convert body motion into the same
                                calibrated features used at runtime. Domain randomisation
                                varies mounting rotation, noise, drift, timing gaps, body
                                shape, and transition speed.
                            </p>
                            <div className="product-model-tags">
                                <b>Four sensor frames</b>
                                <b>10 Hz features</b>
                                <b>ONNX parity</b>
                            </div>
                        </article>
                    </div>

                    <div className="product-model-results">
                        <article>
                            <span>Internal RULA ≥4</span>
                            <strong>PR-AUC 0.468</strong>
                            <p>1/1 validation event · 3.4 s median lead</p>
                            <small>Only seven positive windows from one event.</small>
                        </article>
                        <article>
                            <span>Internal combined rule</span>
                            <strong>PR-AUC 0.374</strong>
                            <p>2/2 validation events · 4.05 s median lead</p>
                            <small>Only 16 positive windows from two events.</small>
                        </article>
                        <article>
                            <span>External office motion</span>
                            <strong>43 clips · 0 alerts</strong>
                            <p>Useful hard-negative behaviour</p>
                            <small>No positive events, so sensitivity is unknown.</small>
                        </article>
                        <article className="product-model-result-warning">
                            <span>Controlled deterioration</span>
                            <strong>0 / 18 detected</strong>
                            <p>Forward-head, trunk, and combined challenges</p>
                            <small>Shows that synthetic-to-real transfer is not solved.</small>
                        </article>
                    </div>

                    <div className="product-model-next">
                        <article>
                            <span>Current limitations</span>
                            <h3>Generalisation remains weak</h3>
                            <p>
                                Internal event counts are very small. A later single-user
                                holdout detected 0/9 events with the global model. A
                                personal model detected 6/9, but also produced five false
                                controlled alerts. CVA remains an IMU-derived indicator,
                                not a clinical measurement.
                            </p>
                        </article>
                        <article>
                            <span>Future work</span>
                            <h3>Build evidence from real mounted sensors</h3>
                            <ul>
                                <li>Record more participants and independent remounting sessions.</li>
                                <li>Add sustained positive events and representative normal work.</li>
                                <li>Validate against synchronized reference posture measurements.</li>
                                <li>Retrain and lock a new model before untouched holdout testing.</li>
                            </ul>
                        </article>
                    </div>
                </ProductSection>
            </main>

            <footer className="product-footer">
                <span>Sit-Sync 2026</span>
                <button
                    type="button"
                    onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                >
                    Back to top
                </button>
            </footer>
        </div>
    );
}
