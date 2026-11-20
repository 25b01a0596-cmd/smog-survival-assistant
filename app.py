import streamlit as st
from google import genai

# --- SETUP & SECURITY ---
client = genai.Client(
    vertexai=True,
    api_key=st.secrets["GEMINI_API_KEY"]
)

# --- UI / ACCESSIBILITY ---
st.set_page_config(page_title="Smog Survival Assistant", page_icon="😷")
st.title("🌬️ Smog Survival & Air Quality Assistant")
st.markdown("Navigate severe winter smog with personalized, low-emission daily routines and indoor air hacks.")

# --- USER INPUTS ---
with st.form("user_input_form"):
    location = st.text_input("Your City / Location", placeholder="e.g., Delhi, India")
    lifestyle = st.selectbox("Your Primary Daily Routine", ["Work from Home", "Office Commuter", "Student", "Outdoor Worker", "Stay-at-home Parent"])
    vulnerable_members = st.checkbox("Are there children, elderly, or asthma patients in your household?")
    submit_button = st.form_submit_button(label="Generate My Survival Plan")

# --- AI GENERATION ---
if submit_button and location:
    with st.spinner("Analyzing local air quality strategies..."):
        try:
            vulnerability_note = "Focus heavily on protecting vulnerable household members." if vulnerable_members else ""
            prompt = f"""
            You are an expert environmental health assistant. The user lives in {location} and their lifestyle is: {lifestyle}.
            {vulnerability_note}

            Please provide a highly structured, easy-to-read guide that includes:
            1. Low-Emission Daily Routines: How they can adjust their schedule to reduce personal emissions.
            2. Indoor Air Quality Hacks: Low-cost or DIY methods to keep indoor air clean.
            3. Sustainable Alternatives: Actionable swaps for commuting or daily activities.
            4. Impact: Briefly explain the direct positive impact of these choices on their health and community.
            """

            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
            )
            st.success("Plan Generated Successfully!")
            st.markdown(response.text)
        except Exception as e:
            st.error(f"Error details: {e}")
