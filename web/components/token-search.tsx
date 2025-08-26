import { search_tokens, Token } from "@/lib/jup";
import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function TokenSearchBox({
  selectedToken,
  setSelectedToken,
}: {
  selectedToken: Token | null;
  setSelectedToken: (token: Token) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Token[]>([]);

  useEffect(() => {
    const fetchTokens = async () => {
      if (query.length < 2) {
        setResults([]);
        return;
      }
      const tokens = await search_tokens(query);
      setResults(tokens);
    };
    fetchTokens();
  }, [query]);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="flex items-center gap-2 px-3 py-1 bg-slate-700 text-white rounded hover:bg-slate-600">
          {selectedToken ? (
            <>
              <img
                src={selectedToken.icon}
                alt={selectedToken.symbol}
                className="w-5 h-5 rounded-full"
              />
              {selectedToken.symbol}
            </>
          ) : (
            "Select token"
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md bg-slate-900 text-white">
        <DialogHeader>
          <DialogTitle>Select a token</DialogTitle>
        </DialogHeader>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any token..."
          className="w-full px-3 py-2 mb-4 bg-slate-800 rounded"
        />
        <div className="max-h-72 overflow-y-auto space-y-1">
          {results.map((t) => (
            <div
              key={t.id}
              onClick={() => {
                setSelectedToken(t);
                setQuery("");
              }}
              className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-700 rounded"
            >
              <img
                src={t.icon}
                alt={t.symbol}
                className="w-6 h-6 rounded-full"
              />
              <div className="flex flex-col">
                <span className="text-sm font-medium">{t.symbol}</span>
                <span className="text-xs text-slate-400">{t.name}</span>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
