import asyncio
import sys
import os
import argparse

try:
    from app.converter import md_file_to_pdf
except ImportError:
    print("Please install required packages:")
    print("pip install -r requirements.txt")
    print("playwright install chromium")
    sys.exit(1)


async def md_to_pdf(md_path, pdf_path):
    print(f"Reading {md_path}...")
    print("Launching headless browser to render PDF...")
    await md_file_to_pdf(md_path, pdf_path)
    print(f"✅ Successfully created: {pdf_path}")

def main():
    parser = argparse.ArgumentParser(description="Convert Markdown to high-fidelity PDF")
    parser.add_argument("input", help="Path to the input .md file")
    parser.add_argument("-o", "--output", help="Path to the output .pdf file (optional)")
    
    args = parser.parse_args()
    
    input_file = args.input
    if not os.path.exists(input_file):
        print(f"Error: File '{input_file}' not found.")
        sys.exit(1)
        
    output_file = args.output
    if not output_file:
        output_file = os.path.splitext(input_file)[0] + ".pdf"
        
    asyncio.run(md_to_pdf(input_file, output_file))

if __name__ == "__main__":
    main()
