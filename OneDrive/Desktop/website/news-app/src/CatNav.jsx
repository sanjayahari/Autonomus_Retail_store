function CategoryNav({ setCategory }) {
  const categories = ["technology", "sports", "business", "health"];

  return (
    <nav className="nav">
      {categories.map((cat) => (
        <button key={cat} onClick={() => setCategory(cat)}>
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
        </button>
      ))}
      
    </nav>
  );
}
export default CategoryNav;
