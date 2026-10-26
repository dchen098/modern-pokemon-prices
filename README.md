# Pokémon Set Price Explorer

TCGplayer market prices for every modern English Pokémon TCG set: the last four years of releases plus the whole Sword & Shield era (51 sets, about 8,400 cards). Pick a set to see its cards ranked by price, then pick a card to chart its price history.

## Where the numbers come from

- **Prices:** TCGplayer market price for Near Mint copies, from [tcgcsv.com](https://tcgcsv.com).
- **History:** a year of weekly prices for the cards in my collection and every card at $10 or more, from TCGplayer. Every card is tracked weekly from Oct 25, 2026.
- **Card lists:** [PokemonTCG/pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data).

## How it updates

Every Monday afternoon, the "Update prices and publish site" job in the Actions tab downloads the latest prices, saves them in `data/`, and republishes the site. To update right away, open the Actions tab, pick that job, and click **Run workflow**.

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `assets/` | The site |
| `data/sets.csv` | Sets, with their TCGplayer group ids |
| `data/cards.csv` | Every card with its current price and TCGplayer product id |
| `data/hist/<set>.csv` | Price history, one row per card per date |
| `data/meta.json` | Date of the latest prices |
| `scripts/update_prices.py` | The weekly price download |

Not affiliated with The Pokémon Company, Nintendo or TCGplayer.
