import { useEffect, useState } from "react";
import axios from "axios";
import Header from "./Header.jsx";
import CategoryNav from "./CatNav.jsx";
import NewsCard from "./NewsCard.jsx";
import "./App.css";

const API_KEY = "8321a48cf08d445c8c29b8f54ff971dd";
const BASE_URL = "https://newsapi.org/v2/top-headlines";

function App() {
  const [articles, setArticles] = useState([]);
  const [category, setCategory] = useState("technology");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function getNews() {
      setLoading(true);
      try {
        const response = await axios.get(
          BASE_URL + "?country=us&category=" + category + "&apiKey=" + API_KEY
        );
        setArticles(response.data.articles);
      } catch (err) {
        console.log("something went wrong:", err);
      }
      setLoading(false);
    }

    getNews();
  }, [category]);

  return (
    <div>
      <Header />
      <CategoryNav setCategory={setCategory} />
      {loading ? (
        <p>Loading news...</p>
      ) : (
        <div className="news-grid">
          {articles.map((a, i) => {
            return <NewsCard key={i} article={a} />;
          })}
        </div>
      )}
    </div>
  );
}

export default App;
