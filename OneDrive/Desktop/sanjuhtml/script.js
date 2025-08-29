
 const apiKey = "d65a9486142c4af8956114643251706";

// Mapping condition to Font Awesome icons
function getWeatherIcon(condition) {
    const text = condition.toLowerCase();
    if (text.includes("sunny")) return "fas fa-sun";
    if (text.includes("clear")) return "fas fa-sun";
    if (text.includes("cloudy")) return "fas fa-cloud";
    if (text.includes("partly")) return "fas fa-cloud-sun";
    if (text.includes("rain")) return "fas fa-cloud-rain";
    if (text.includes("thunder")) return "fas fa-cloud-showers-heavy";
    if (text.includes("snow")) return "fas fa-snowflake";
    return "fas fa-cloud"; // default fallback
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    const options = { weekday: 'long', day: 'numeric', month: 'short' };
    return date.toLocaleDateString("en-US", options);
}

// Fetch and update weather for a given query (city or coordinates)
async function fetchAndDisplayWeather(query) {
    try {
        const res = await fetch(`https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${query}&days=5&aqi=yes`);
        const data = await res.json();

        const infoDiv = document.querySelector(".main-weather .info");
        const detailsDiv = document.querySelector(".main-weather .details");

        const { name, country, localtime } = data.location;
        const { temp_c, humidity, wind_kph, condition, air_quality } = data.current;

        infoDiv.innerHTML = `
            <h2>${country}</h2>
            <h1>${name}</h1>
            <p>${condition.text}</p>
            <p>${temp_c}°C | ${humidity}% Humidity</p>
            <p>Wind: ${wind_kph}km/h | AQI: ${Math.round(air_quality.pm2_5)}</p>
        `;

        const [date, time] = localtime.split(" ");
        detailsDiv.innerHTML = `
            <p>${date} | ${time}</p>
            <p>Condition: ${condition.text}</p>
        `;

        // Update 5-day forecast
        const forecastDiv = document.querySelector(".forecast");
        forecastDiv.innerHTML = "";

        data.forecast.forecastday.forEach(day => {
            const iconClass = getWeatherIcon(day.day.condition.text);
            const formattedDate = formatDate(day.date);
            const [weekday, dateStr] = formattedDate.split(", ");

            const forecastHTML = `
                <div class="day">
                    <h3>${weekday}</h3>
                    <p>${dateStr}</p>
                    <i class="${iconClass}"></i>
                    <p>${day.day.mintemp_c}~${day.day.maxtemp_c}°C</p>
                    <p>${day.day.condition.text}</p>
                    <p><small>UV: ${day.day.uv}</small></p>
                </div>
            `;

            forecastDiv.innerHTML += forecastHTML;
        });

    } catch (error) {
        alert("Weather data not found for this location.");
        console.error(error);
    }
}

// Triggered by search button
async function searchLocation() {
    const input = document.getElementById("locationInput");
    const location = input.value.trim();
    if (!location) return;
    fetchAndDisplayWeather(location);
}

// Add mini city card (no forecast)
async function addLocation() {
    const input = document.getElementById("locationInput");
    const location = input.value.trim();
    if (!location) return;

    try {
        const res = await fetch(`https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${location}&aqi=yes`);
        const data = await res.json();

        const citiesContainer = document.querySelector(".cities");
        const cityDiv = document.createElement("div");
        cityDiv.className = "city";
        cityDiv.innerHTML = `${data.location.name}<br><strong>${data.current.temp_c}°C</strong>`;

        cityDiv.addEventListener("click", () => {
            citiesContainer.removeChild(cityDiv);
        });

        citiesContainer.appendChild(cityDiv);
        input.value = "";
    } catch (error) {
        alert("Error adding location.");
    }
}

// 🔍 Get exact location using browser GPS
function getCurrentLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async position => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                const coords = `${lat},${lon}`;
                fetchAndDisplayWeather(coords);
            },
            error => {
                alert("Location access denied or unavailable.");
                console.error(error);
            }
        );
    } else {
        alert("Geolocation is not supported by this browser.");
    }
}

// Optional: Auto-load on page load with current location
window.onload = getCurrentLocation;
