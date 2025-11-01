function NewsCard({ article }) {
  return (
    <div className="card">
        {/* /apna card jisme news dikhegi */}
      <img
        src={article.urlToImage || "https://via.placeholder.com/400"}      
        alt={article.title}
      />
      <div className="card-body">
        <h2>{article.title}</h2>
        <p className="source">{article.source?.name}</p>
        <a href={article.url} target="_blank" rel="kuch bhi">
          Read More →
        </a>
      </div>
    </div>
  );
}
export default NewsCard;
