import { useEffect } from 'react'

/**
 * Help for the page you are actually on.
 *
 * Written per tab rather than as one manual, because the question someone has
 * is nearly always about what is in front of them. A single help page would
 * make them find their own situation in it first.
 *
 * Every claim here describes behaviour that exists. Help that describes what
 * the app was meant to do is worse than none, since it is trusted by anyone who
 * bothered to open it.
 */
const HELP = {
  backlog: {
    title: 'Backlog',
    blurb: 'Everything you own or are considering, with the maths for whether grading it pays.',
    sections: [
      {
        h: 'Adding cards',
        items: [
          'Search by name, and include the set to narrow it down. Every era is searchable.',
          'Stored sets answer for free. Anything outside them falls through to the full catalogue at one credit per result, and the results say when that happened. Adding a card costs two more for its price and graded sales.',
          'Japanese cards live in a separate collection, so switch the language or an English search will not find them.',
          'Repeating a search is free. Results are cached.',
        ],
      },
      {
        h: 'What you paid',
        items: [
          'Press + on a row to open it, then enter a price per copy. Buying the same card three times at different prices records all three.',
          'Copies you leave blank are costed at market value, so the numbers work before you have entered anything.',
          'Net ea. and After fees both measure against what you paid.',
        ],
      },
      {
        h: 'Reading a row',
        items: [
          'Raw value is what the card is worth ungraded today. Graded value is what it is worth at the target grade.',
          'Net ea. is the gain before selling fees. After fees is what you would actually receive, and is the number to judge on.',
          'Tier is chosen automatically from the declared value, which is the expected graded price. Pin one yourself if you disagree.',
        ],
      },
      {
        h: 'Sending cards',
        items: [
          'Tick the rows you want and choose New submission, or add them to one you already have.',
          'You pick how many copies to send, so sending two of four leaves the other two here with their own purchase prices.',
        ],
      },
    ],
  },

  submissions: {
    title: 'Submissions',
    blurb: 'Batches you are preparing or waiting on.',
    sections: [
      {
        h: 'Building a batch',
        items: [
          'Start one here and search for cards inside it, or tick cards in the Backlog and add them.',
          'Cards added here appear in your Backlog too, marked Submitted. There is one record, not two.',
        ],
      },
      {
        h: 'The scenarios',
        items: [
          'The tiles at the top assume every card hits its target grade. That is the ceiling, not a forecast.',
          'Set a gem rate and the three cases below show which cards hitting or missing produces which result. Worst case is your best cards missing, best case is only your cheapest.',
          'Once you have imported a finished order you can tick Use my average, which substitutes what your cards have actually returned.',
        ],
      },
      {
        h: 'Status',
        items: [
          'Draft while you are choosing, At PSA once it is sent, Completed when it is back.',
          'Marking it Completed moves it to the Completed tab, keeping its cards and figures.',
          'Deleting a submission returns its cards to the Backlog rather than destroying them.',
        ],
      },
    ],
  },

  completed: {
    title: 'Completed',
    blurb: 'Finished batches, and what your cards actually graded.',
    sections: [
      {
        h: 'Importing an order',
        items: [
          'PSA gives you a CSV for a finished order. Import it and each cert, card and grade is recorded.',
          'Imported cards are held on the order rather than added to your Backlog. They have no price or printing, so nothing can be calculated from them.',
        ],
      },
      {
        h: 'Target grades',
        items: [
          'Each card has its own target, so a chase card you wanted a 10 from and bulk you would take a 9 on are scored separately.',
          'A card counts as a hit at or above its target. Aiming for a 9 and getting a 10 is not a miss.',
        ],
      },
      {
        h: 'Using the result',
        items: [
          'The hit rate is measured, not estimated. It is the same figure the scenario planner asks you to guess before sending anything.',
          'Use N% for new submissions saves it, so future batches start from what your cards actually do.',
        ],
      },
    ],
  },

  find: {
    title: 'Find cards',
    blurb: 'Searches the market for cards worth grading, rather than reporting on yours.',
    sections: [
      {
        h: 'Scanning',
        items: [
          'Pick an era and a scan size. Cards are fetched most valuable first, at two credits each, because graded sale data has to be read before anything can be ranked.',
          'Results are shared for a day, so a scan someone has already run costs nothing.',
        ],
      },
      {
        h: 'The filters',
        items: [
          'Min PSA 10 sales per week is the important one. It measures how often that grade actually trades, and a price built on a handful of sales is not a market price.',
          'Hide implausible removes rows where the graded price or the raw price looks wrong rather than promising. Ranking by return puts those at the top.',
        ],
      },
      {
        h: 'Reading it',
        items: [
          'The multiple beside the graded value is how many times the raw price it sells for. Anything past about twenty usually means the raw price is not for a gradeable copy.',
          'A row marked no tier is worth more than your highest grading tier covers, so it is costed as though grading were free and its return reads too high.',
        ],
      },
    ],
  },

  settings: {
    title: 'Settings',
    blurb: 'The numbers every calculation runs on.',
    sections: [
      {
        h: 'Tiers',
        items: [
          'These decide the grading fee, and PSA changes its price list often. Check them against PSA before trusting a profit figure.',
          'A card worth more than your highest tier covers has no fee to charge, so it is costed as though grading were free.',
        ],
      },
      {
        h: 'Prices',
        items: [
          'Price basis chooses which figure a graded price comes from. Recent and filtered is the provider’s own estimate and the usual choice.',
          'Selling fees are what a marketplace takes. Fifteen per cent is about right for eBay; vendors differ.',
        ],
      },
      {
        h: 'Your data',
        items: [
          'Everything lives in this browser. Nothing is uploaded, and clearing your browser data would remove it.',
          'Export backup writes cards, submissions, prices and settings to one file. That is also how you move to another computer.',
        ],
      },
    ],
  },
}

export default function HelpPanel({ tab, open, onToggle }) {
  // Escape closes it, which is what anyone will reach for before finding the
  // button again.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onToggle(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onToggle])

  const help = HELP[tab]
  if (!help) return null

  return (
    <>
      <button
        className={'help-tab' + (open ? ' on' : '')}
        onClick={() => onToggle(!open)}
        aria-expanded={open}
        title={open ? 'Close help' : `How to use ${help.title}`}
      >
        {open ? 'Close' : 'Help'}
      </button>

      {/* Click-away, and something to dim the page behind so the panel reads
          as being on top of it rather than beside it. */}
      {open && <div className="help-scrim" onClick={() => onToggle(false)} />}

      <aside className={'help-panel' + (open ? ' on' : '')} aria-hidden={!open}>
        <div className="help-head">
          <div>
            <div className="micro">Help</div>
            <h2>{help.title}</h2>
          </div>
          <button className="ghost" onClick={() => onToggle(false)} title="Close">✕</button>
        </div>

        <p className="help-blurb">{help.blurb}</p>

        {help.sections.map((sec) => (
          <div className="help-sec" key={sec.h}>
            <div className="micro">{sec.h}</div>
            <ul>
              {sec.items.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </div>
        ))}
      </aside>
    </>
  )
}
