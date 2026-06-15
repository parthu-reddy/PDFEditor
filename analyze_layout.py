import pdfplumber
import sys

def analyze_pdf(path):
    print(f"\n=== Analyzing {path} ===")
    with pdfplumber.open(path) as pdf:
        page = pdf.pages[0]
        words = page.extract_words()
        
        lines = []
        current_y = None
        current_line = []
        
        for word in words:
            y = round(word['top'])
            if current_y is None or abs(current_y - y) > 5:
                if current_line:
                    lines.append((current_y, " ".join(current_line)))
                current_line = [word['text']]
                current_y = y
            else:
                current_line.append(word['text'])
                
        if current_line:
            lines.append((current_y, " ".join(current_line)))
            
        lines.sort(key=lambda x: x[0])
        
        for y, text in lines:
            print(f"Y: {y} -> {text[:80]}")
            
        print("\n--- Overlap Check ---")
        for i in range(len(lines)-1):
            y1 = lines[i][0]
            y2 = lines[i+1][0]
            diff = abs(y1 - y2)
            if diff < 10 and diff > 0:
                print(f"⚠️ POTENTIAL OVERLAP: Y={y1} and Y={y2}")
                print(f"  Line 1: {lines[i][1][:50]}")
                print(f"  Line 2: {lines[i+1][1][:50]}")

if __name__ == "__main__":
    analyze_pdf("demo-contract.pdf")
    analyze_pdf("demo-contract-edited.pdf")
