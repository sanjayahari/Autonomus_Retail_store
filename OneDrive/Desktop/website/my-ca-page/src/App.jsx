import React, { useRef, useEffect, useState, useCallback } from 'react';

// --- Global Data and Utilities ---

const getRandomMargin = () => Math.floor(Math.random() * (120 - 90 + 1)) + 90;

const responsibilities = [
    { id: 1, icon: '📅', title: 'Project Oversight', description: 'Meticulous management of all project timelines and budget.', alignment: 'left', marginBottom: getRandomMargin() },
    { id: 2, icon: '👥', title: 'Team Leadership', description: 'Foster collaboration, mentor staff, resolve conflicts.', alignment: 'right', marginBottom: getRandomMargin() },
    { id: 3, icon: '🗣️', title: 'Client Communication', description: 'Primary liaison, transparency, manage stakeholder expectations.', alignment: 'left', marginBottom: getRandomMargin() },
    { id: 4, icon: '🛡️', title: 'Quality Assurance', description: 'Establish quality standards and review processes.', alignment: 'right', marginBottom: getRandomMargin() },
    { id: 5, icon: '⚠️', title: 'Risk Management', description: 'Identify roadblocks, assess impact, and mitigate risks.', alignment: 'left', marginBottom: getRandomMargin() },
    { id: 6, icon: '📈', 'title': 'Strategic Planning', description: 'Contribute insights to long-term goals and future innovation.', alignment: 'right', marginBottom: getRandomMargin() },
];

const EMOJI_POOL = ['✨', '🌟', '❄️', '🔹', '🔷', '⚡️'];

// Inject necessary CSS keyframes
const injectKeyframes = () => {
    if (!document.getElementById('dynamicKeyframes')) {
        const style = document.createElement('style');
        style.id = 'dynamicKeyframes';
        style.innerHTML = `
            @keyframes floatTitle {
                0% { transform: translateY(0); }
                50% { transform: translateY(-15px); }
                100% { transform: translateY(0); }
            }
            @keyframes popAndFloat {
                0% { opacity: 0; transform: translateY(0) scale(0.5); }
                20% { opacity: 1; transform: translateY(-10px) scale(1.1); }
                100% { opacity: 0; transform: translateY(-100px) scale(0.8); }
            }
        `;
        document.head.appendChild(style);
    }
};

// --- Curve Calculation Logic (Cubic Bézier for smooth path) ---

function getCubicControlPoints(points, tension=0.35) {
    const cp = [];
    for (let i = 0; i < points.length - 1; i++) {
        let p0 = points[i === 0 ? i : i - 1];
        let p1 = points[i];
        let p2 = points[i + 1];
        let p3 = points[i + 2 === points.length ? i + 1 : i + 2];
        if (!p0 || !p3) { p0 = p1; p3 = p2; }
        const dx1 = (p2.x - p0.x) * tension;
        const dy1 = (p2.y - p0.y) * tension;
        const cp1 = { x: p1.x + dx1 / 3, y: p1.y + dy1 / 3 };
        const dx2 = (p3.x - p1.x) * tension;
        const dy2 = (p3.y - p1.y) * tension;
        const cp2 = { x: p2.x - dx2 / 3, y: p2.y - dy2 / 3 };
        cp.push([cp1.x, cp1.y, cp2.x, cp2.y]);
    }
    return cp;
}

// --- Individual Components ---

// 1. Animated Fan Component
const FanSpinner = React.memo(({ angle, isRightAligned }) => (
    <div
        className={`
            // Base/Mobile: Center-aligned
            absolute w-16 h-16 top-1/2 -translate-y-1/2 opacity-90 z-10 pointer-events-none 
            left-1/2 -translate-x-1/2 
            
            // Desktop (md): Shifted to alternating sides, specific positioning
            md:w-[60px] md:h-[60px]
            ${isRightAligned 
                ? 'md:right-320px md:left-auto md:translate-x-0' // fan-right equivalent (for alternating layout)
                : 'md:left-320px md:right-auto md:translate-x-0' // fan-left equivalent (for alternating layout)
            }
        `}
    >
        <svg viewBox="0 0 60 60" width={60} height={60} className="block">
            <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: "30px 30px", transition: 'transform 0.05s linear' }}>
                {[0, 90, 180, 270].map((rot, i) => (
                    <path
                        key={i}
                        d={`M30 30 L30 10 Q34 16 32 28 Q32 35 30 30 Z`}
                        fill="url(#bladeGradient)"
                        transform={`rotate(${rot} 30 30)`}
                        style={{ filter: "drop-shadow(0 2px 4px #48c4e0aa)" }}
                    />
                ))}
                <circle cx={30} cy={30} r={9} fill="url(#hubGradient)" stroke="#ededed" strokeWidth={2} />
                <ellipse cx="30" cy="26" rx="7" ry="3.5" fill="#fff" opacity="0.21" />
                <circle cx={30} cy={30} r={11} fill="none" stroke="#0ff" strokeWidth={1} opacity={0.25} />
                <defs>
                    <radialGradient id="hubGradient" cx="50%" cy="50%" r="64%">
                        <stop offset="0%" stopColor="#fff" />
                        <stop offset="42%" stopColor="#e6f8fb" />
                        <stop offset="100%" stopColor="#94e6f7" />
                    </radialGradient>
                    <linearGradient id="bladeGradient" x1="30" y1="10" x2="34" y2="35" gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stopColor="#b2effa" />
                        <stop offset="80%" stopColor="#06b6d4" />
                        <stop offset="100%" stopColor="#0194ab" />
                    </linearGradient>
                </defs>
            </g>
        </svg>
    </div>
));

// 2. Header Component
const TitlePlatform = () => (
    <header className="text-center pt-16 md:pt-24 mx-auto max-w-6xl">
        <div className="bg-slate-800/75 backdrop-blur-sm p-6 md:p-10 rounded-xl border border-cyan-200/20 mb-10 md:mb-16 shadow-2xl shadow-cyan-400/40 animate-[floatTitle_6s_ease-in-out_infinite] relative z-50">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl leading-tight font-extrabold text-blue-400">Responsibility</h1>
            <p className="mt-3 text-lg md:text-xl text-cyan-300 max-w-3xl mx-auto">Our six core responsibilities on a dynamic path.</p>
        </div>
    </header>
);

// 3. Floating Emoji Component
const FloatingEmoji = ({ e }) => (
    <div
        key={e.id}
        className="absolute text-2xl pointer-events-none z-100 animate-[popAndFloat_2s_forwards_ease-out]"
        style={{ left: `${e.x}px`, top: `${e.y}px` }}
    >
        {e.emoji}
    </div>
);

// 4. Individual Step Component
const TimelineStep = React.forwardRef(({ step, isVisible, fanAngle }, ref) => {
    const isRightAligned = step.alignment === 'right';
    const visibilityClass = isVisible
        ? 'opacity-100 translate-y-0 scale-100'
        : 'opacity-0 translate-y-12 scale-90';

    const dynamicMarginStyle = {
        marginBottom: `${step.marginBottom}px`,
    };

    return (
        <div
            key={step.id}
            ref={ref}
            data-step-id={step.id}
            className={`
                timeline-step relative z-10 
                w-[95%] sm:w-[80%] max-w-md 
                mx-auto // Center on mobile
                transition-all duration-700 ease-[cubic-bezier(0.68,-0.55,0.265,1.55)] 
                ${visibilityClass}
                
                // Responsive Positioning (md:)
                md:max-w-[300px] 
                md:w-full 
                md:mx-0 
                ${isRightAligned 
                    ? 'md:ml-auto md:mr-[10%]' 
                    : 'md:mr-auto md:ml-[10%]' 
                }
            `}
            style={dynamicMarginStyle}
        >
            <FanSpinner angle={fanAngle} isRightAligned={isRightAligned} />
            
            {/* Timeline Card */}
            <div className={`
                relative bg-slate-800/80 backdrop-blur-sm border-4 p-5 rounded-lg shadow-xl hover:shadow-blue-500/70 transition-all duration-300 
                ${isRightAligned 
                    ? 'border-r-blue-500' 
                    : 'border-l-blue-500' 
                }
            `}>
                <h2 className="text-xl font-bold text-blue-300 md:text-2xl">{step.title}</h2>
                <p className="mt-2 text-slate-300 text-sm md:text-base">{step.description}</p>
                
                {/* Step Marker */}
                <div
                    className={`
                        step-marker absolute w-10 h-10 leading-10 text-center text-2xl font-bold rounded-full bg-blue-500 text-white z-20 shadow-lg shadow-blue-500/50 border-4 border-slate-900 
                        top-5 
                        
                        // Responsive Marker position
                        left-1/2 -translate-x-1/2 // Center on mobile
                        md:left-auto md:translate-x-0
                        ${isRightAligned ? 'md:right-[-2.25rem]' : 'md:left-[-2.25rem]'}
                    `}
                >
                    {step.icon}
                </div>
            </div>
        </div>
    );
});

// 5. Timeline Container (Manages Path and Steps)
const TimelineContainer = ({ fanAngle, isVisible, stepsRefs, updateCurve, handleScroll, getMarkerCenter }) => {
    const timelineRef = useRef(null);
    const curvePathRef = useRef(null);
    
    // Pass refs out to the main App component for external reference
    useEffect(() => {
        if (timelineRef.current) updateCurve(timelineRef, curvePathRef, stepsRefs, getMarkerCenter);
    }, [updateCurve, stepsRefs, getMarkerCenter]);

    useEffect(() => {
        // Since this component is responsible for the DOM structure, we run the listeners here
        let ticking = false;
        const onScroll = () => {
            if (!ticking) {
                window.requestAnimationFrame(() => {
                    handleScroll(timelineRef, curvePathRef, isVisible);
                    ticking = false;
                });
                ticking = true;
            }
        };

        window.addEventListener('scroll', onScroll);
        window.addEventListener('resize', () => updateCurve(timelineRef, curvePathRef, stepsRefs, getMarkerCenter));
        
        setTimeout(() => {
            onScroll();
            updateCurve(timelineRef, curvePathRef, stepsRefs, getMarkerCenter);
        }, 100);

        return () => {
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', () => updateCurve(timelineRef, curvePathRef, stepsRefs, getMarkerCenter));
        };
    }, [updateCurve, handleScroll, isVisible, stepsRefs, getMarkerCenter]);


    return (
        <div id="timeline" ref={timelineRef} className="relative py-5 w-full max-w-7xl mx-auto">
            {/* SVG Curve Path */}
            <svg className="absolute top-0 left-0 w-full h-full z-10 overflow-visible pointer-events-none" xmlns="http://www.w3.org/2000/svg">
                <path
                    id="curvePath"
                    ref={curvePathRef}
                    className="fill-none stroke-cyan-300 stroke-[4px] stroke-round drop-shadow-lg drop-shadow-cyan-300 transition-[stroke-dashoffset] duration-300 linear"
                    d=""
                />
            </svg>
            {responsibilities.map((step, i) => (
                <TimelineStep
                    key={step.id}
                    ref={el => stepsRefs.current[i] = el}
                    step={step}
                    isVisible={isVisible[i]}
                    fanAngle={fanAngle}
                />
            ))}
        </div>
    );
};


// --- 6. Main App Component (Manages State and Top-Level Effects) ---

const App = () => {
    const stepsRefs = useRef([]);
    const scrollCounter = useRef(0);

    const [fanAngle, setFanAngle] = useState(0);
    const [isVisible, setIsVisible] = useState(new Array(responsibilities.length).fill(false));
    const [floatingEmojis, setFloatingEmojis] = useState([]);

    // Helper: center of marker
    const getMarkerCenter = useCallback((stepEl, timelineRect) => {
        const marker = stepEl?.querySelector('.step-marker');
        if (!marker) return null;
        const rect = marker.getBoundingClientRect();
        return {
            x: rect.left + rect.width / 2 - timelineRect.left,
            y: rect.top + rect.height / 2 - timelineRect.top
        };
    }, []);

    // Construct curve path
    const updateCurve = useCallback((timelineRef, curvePathRef, stepsRefs, getMarkerCenter) => {
        const path = curvePathRef.current;
        const timeline = timelineRef.current;
        if (!path || !timeline || stepsRefs.current.length < 2) return;

        const timelineRect = timeline.getBoundingClientRect();
        const containerWidth = timeline.offsetWidth;
        const sidePadding = containerWidth * 0.05; 

        // Gather marker coords, clamped horizontally
        const points = stepsRefs.current.map(ref => {
            if (!ref) return null;
            const p = getMarkerCenter(ref, timelineRect);
            return {
                x: Math.max(sidePadding, Math.min(containerWidth - sidePadding, p.x)),
                y: p.y,
            };
        }).filter(p => p !== null);

        if (points.length < 2) return;

        // Use cubic Bézier for smooth curve
        const controls = getCubicControlPoints(points);
        let d = '';
        if (points.length > 0) d = `M${points[0].x},${points[0].y}`;
        for (let i = 0; i < controls.length; i++) {
            d += ` C${controls[i][0]},${controls[i][1]} ${controls[i][2]},${controls[i][3]} ${points[i+1].x},${points[i+1].y}`;
        }
        path.setAttribute('d', d);

        const total = path.getTotalLength();
        path.style.strokeDasharray = total;
        path.style.strokeDashoffset = total;
    }, [getMarkerCenter]);

    const popRandomEmoji = useCallback(() => {
        const container = document.body;
        const spawnRange = 250;
        const x = Math.random() * (container.clientWidth - spawnRange) + (spawnRange / 2);
        const y = window.scrollY + window.innerHeight / 2;
        const newEmoji = { id: Date.now() + Math.random(), emoji: EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)], x: x, y: y, };
        setFloatingEmojis(prev => [...prev, newEmoji]);
        setTimeout(() => { setFloatingEmojis(prev => prev.filter(e => e.id !== newEmoji.id)); }, 2100);
    }, []);

    // Handle scroll for line drawing and step reveal
    const handleScroll = useCallback((timelineRef, curvePathRef, currentIsVisible) => {
        const curve = curvePathRef.current;
        const timeline = timelineRef.current;
        if (!curve || !timeline) return;

        const scrollY = window.scrollY;
        setFanAngle(scrollY * 0.7);

        // Emoji
        scrollCounter.current += 1;
        if (scrollCounter.current % 10 === 0) {
            popRandomEmoji();
        }

        // Path Reveal
        const totalLength = curve.getTotalLength();
        const contentHeight = timeline.offsetHeight + timeline.offsetTop;
        const scrollableArea = contentHeight - window.innerHeight;
        const pathProgress = Math.min(1, Math.max(0, scrollY / scrollableArea));
        curve.style.strokeDashoffset = totalLength * (1 - pathProgress);

        // Step visibility calculation
        const newIsVisible = currentIsVisible.slice();
        let changed = false;
        const stepsCount = stepsRefs.current.length;
        for (let i = 0; i < stepsCount; ++i) {
            const threshold = totalLength * (i / (stepsCount > 1 ? stepsCount - 1 : 1));
            const reveal = (totalLength * (1 - pathProgress)) <= (totalLength - threshold);
            if (reveal !== newIsVisible[i]) { newIsVisible[i] = reveal; changed = true; }
        }
        if (changed) setIsVisible(newIsVisible);
    }, [popRandomEmoji, stepsRefs]); // Removed isVisible from dependency array to use the function argument

    useEffect(() => {
        injectKeyframes();
    }, []);

    return (
        <div
            className="font-sans bg-slate-900 text-slate-50 min-h-screen overflow-x-hidden relative"
        >
            <div className="content-wrap relative z-10">
                {floatingEmojis.map(e => (
                    <FloatingEmoji key={e.id} e={e} />
                ))}
                <TitlePlatform />
                <TimelineContainer 
                    fanAngle={fanAngle}
                    isVisible={isVisible}
                    stepsRefs={stepsRefs}
                    updateCurve={updateCurve}
                    handleScroll={(tRef, cRef) => handleScroll(tRef, cRef, isVisible)} // Pass isVisible via closure for safe state update
                    getMarkerCenter={getMarkerCenter}
                />
                <div className="h-64"></div>
            </div>
        </div>
    );
};

export default App;
